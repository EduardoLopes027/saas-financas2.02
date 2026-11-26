'use strict';

const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { readFile, mkdir } = require('node:fs/promises');
const { createServer } = require('node:http');
const { dirname, join } = require('node:path');
const { promisify } = require('node:util');
const { transactionFields, transactionStore, MAX_TRANSACTION_BODY } = require('./transactions.cjs');
const { callbackPath, challenge, failure, flowCookie, newFlow, readFlow, redirect } = require('./google-oauth.cjs');

const { profileUpdates, userProfile } = require('./account-settings.cjs');

const deriveKey = promisify(scrypt);
const COOKIE = 'finflow_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const POSTGRES_MAX_AMOUNT = 999999999999;
const HOSTED_MAX_RECEIPT = 3 * 1024 * 1024;
const HOSTED_MAX_BODY = 4 * Math.ceil(HOSTED_MAX_RECEIPT / 3) + 32 * 1024;
const ROOT = join(__dirname, '..', 'public');
const DUMMY_SALT = randomBytes(16);
const DUMMY_HASH = randomBytes(64);
const assets = new Map([
  ["/",["index.html","text/html; charset=utf-8"]],
  ["/index.html",["index.html","text/html; charset=utf-8"]],
  ["/Prototipo.html",["index.html","text/html; charset=utf-8"]],
  ["/assets/css/app.css",["assets/css/app.css","text/css; charset=utf-8"]],
  ["/assets/css/auth.css",["assets/css/auth.css","text/css; charset=utf-8"]],
  ["/assets/css/transactions.css",["assets/css/transactions.css","text/css; charset=utf-8"]],
  ["/assets/css/stitch-home.css",["assets/css/stitch-home.css","text/css; charset=utf-8"]],
  ["/assets/css/new-entry.css",["assets/css/new-entry.css","text/css; charset=utf-8"]],
  ["/assets/js/app.js",["assets/js/app.js","text/javascript; charset=utf-8"]],
  ["/assets/js/new-entry.js",["assets/js/new-entry.js","text/javascript; charset=utf-8"]],
  ["/assets/js/monthly-balance.js",["assets/js/monthly-balance.js","text/javascript; charset=utf-8"]],
  ["/assets/images/FinFlow-avatar.jpg",["assets/images/FinFlow-avatar.jpg","image/jpeg"]],
  ["/assets/fonts/InterVariable.woff2",["assets/fonts/InterVariable.woff2","font/woff2"]],
  ["/assets/fonts/HankenGrotesk.woff2",["assets/fonts/HankenGrotesk.woff2","font/woff2"]],
  ["/assets/fonts/PlusJakartaSans.woff2",["assets/fonts/PlusJakartaSans.woff2","font/woff2"]],
  ["/assets/fonts/MaterialSymbols.woff2",["assets/fonts/MaterialSymbols.woff2","font/woff2"]],
  ["/assets/fonts/AuthSymbols.woff2",["assets/fonts/AuthSymbols.woff2","font/woff2"]],
]);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }).end(JSON.stringify(body));
}

async function readJson(request, limit = 4096) {
  // The Vercel Node helpers may consume the stream and expose the parsed JSON.
  if (request.readableEnded && Object.hasOwn(request, 'body')) {
    if (Number(request.headers['content-length']) > limit) throw new HttpError(413, 'body_too_large');
    let body;
    try {
      body = request.body;
      if (body === undefined) throw new Error();
    } catch {
      throw new HttpError(400, 'invalid_json');
    }
    if (Buffer.byteLength(JSON.stringify(body)) > limit) throw new HttpError(413, 'body_too_large');
    return body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  return body;
}

async function readCredentials(request, isRegister) {
  const body = await readJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || typeof password !== 'string' || password.length === 0 || Buffer.byteLength(password) > 1024) {
    throw new HttpError(400, 'invalid_input');
  }
  const name = isRegister ? body.name : undefined;
  const salaryDay = isRegister ? body.salaryDay : undefined;
  const remember = isRegister ? undefined : body.remember;
  if ((name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 120))
      || (salaryDay !== undefined && !['1', '5', '10', '15', '20', '25', '30'].includes(salaryDay))
      || (remember !== undefined && typeof remember !== 'boolean')) {
    throw new HttpError(400, 'invalid_input');
  }
  return { email, password, name: name?.trim(), salaryDay, remember };
}

function cookieHeaders(token, maxAge, secure) {
  const security = '; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '');
  return [
    COOKIE + '=' + token + '; Path=/api' + security + (maxAge === null ? '' : '; Max-Age=' + maxAge),
    COOKIE + '=; Path=/api/auth' + security + '; Max-Age=0',
  ];
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionHash(request) {
  const match = (request.headers.cookie ?? '').match(/(?:^|;\s*)finflow_session=([\w-]{43})(?=;|$)/);
  return match ? tokenHash(match[1]) : null;
}

function hashPassword(password, salt) {
  return deriveKey(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
}

async function sqliteStore(databasePath) {
  const { DatabaseSync } = require('node:sqlite');
  if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt BLOB NOT NULL,
      password_hash BLOB NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_attempts (
      bucket INTEGER PRIMARY KEY,
      attempts INTEGER NOT NULL
    ) STRICT;
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(users)').all();
    if (!columns.some(column => column.name === 'name')) db.exec('ALTER TABLE users ADD COLUMN name TEXT');
    if (!columns.some(column => column.name === 'salary_day')) db.exec('ALTER TABLE users ADD COLUMN salary_day TEXT');
    const profileColumns = {
      phone: 'TEXT', payday_rule: 'TEXT', payday_day: 'INTEGER',
      theme: "TEXT NOT NULL DEFAULT 'light'", carry_over: 'INTEGER NOT NULL DEFAULT 1',
      amount_mask: 'INTEGER NOT NULL DEFAULT 1', currency: "TEXT NOT NULL DEFAULT 'BRL'",
      created_at: 'TEXT', updated_at: 'TEXT',
    };
    for (const [column, definition] of Object.entries(profileColumns)) {
      if (!columns.some(existing => existing.name === column)) {
        db.exec('ALTER TABLE users ADD COLUMN ' + column + ' ' + definition);
      }
    }
    // Keep ownership IDs unique even after an account is purged.
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_id_sequence (id INTEGER NOT NULL) STRICT;
      INSERT INTO user_id_sequence SELECT COALESCE(MAX(id), 0) FROM users
        HAVING NOT EXISTS (SELECT 1 FROM user_id_sequence);
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  const getUser = db.prepare('SELECT * FROM users WHERE email = ?');
  const allocateUserId = db.prepare('UPDATE user_id_sequence SET id = id + 1 RETURNING id');
  const addUser = db.prepare(`
    INSERT INTO users(id, email, password_salt, password_hash, name, salary_day, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING
  `);
  const activeUserId = 'SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?';
  const purgeUser = db.prepare('DELETE FROM users WHERE id = (' + activeUserId + ')');
  const getSession = db.prepare(`
    SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const transactions = transactionStore(db);
  const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const addSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?)');
  const clearAttempts = db.prepare('DELETE FROM auth_attempts WHERE bucket < ?');
  const recordAttempt = db.prepare(`
    INSERT INTO auth_attempts VALUES (?, 1)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1
    WHERE attempts < ? RETURNING attempts
  `);
  return {
    close: () => db.close(),
    getUser: email => getUser.get(email),
    addUser(email, salt, hash, name, salaryDay) {
      const { id } = allocateUserId.get();
      const result = addUser.run(id, email, salt, hash, name ?? null, salaryDay ?? null, new Date().toISOString());
      return result.changes ? result.lastInsertRowid : undefined;
    },
    getSession: (hash, now) => getSession.get(hash, now),
    updateProfile(hash, now, updates) {
      const assignments = updates.map(([column]) => column + ' = ?').join(', ');
      const values = updates.map(([, value]) => typeof value === 'boolean' ? Number(value) : value);
      return db.prepare('UPDATE users SET ' + assignments + ', updated_at = ? WHERE id = ('
        + activeUserId + ') RETURNING *').get(...values, new Date(now).toISOString(), hash, now);
    },
    purgeUser: (hash, now) => Boolean(purgeUser.run(hash, now).changes),
    deleteSession: hash => deleteSession.run(hash),
    rotateSession(hash, userId, expires, previous, now) {
      db.exec('BEGIN IMMEDIATE');
      try {
        deleteExpired.run(now);
        deleteSession.run(previous);
        addSession.run(hash, userId, expires);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    recordAttempt(bucket) {
      clearAttempts.run(bucket);
      return Boolean(recordAttempt.get(bucket, MAX_ATTEMPTS));
    },
    transactions,
  };
}

function createHandler(store, { secure = false, postgres = false, expectedOrigin, google } = {}) {
  const { transactions } = store;
  const maxAmount = postgres ? POSTGRES_MAX_AMOUNT : Number.MAX_SAFE_INTEGER;
  const maxBody = secure ? HOSTED_MAX_BODY : MAX_TRANSACTION_BODY;
  let activeHashes = 0;

  function account(id, email, name, salaryDay) {
    return { id, email, ...(name && { name }), ...(salaryDay && { salaryDay }) };
  }

  async function requireSession(request) {
    const user = await store.getSession(sessionHash(request), Date.now());
    if (!user) throw new HttpError(401, 'unauthenticated');
    return userProfile(user, Boolean(secure && google));
  }

  function confirmAccount(user, expectedUserId) {
    if (!Number.isSafeInteger(expectedUserId) || expectedUserId < 1) {
      throw new HttpError(400, 'invalid_account');
    }
    if (user.id !== expectedUserId) throw new HttpError(409, 'account_changed');
  }

  async function authenticate(request, response, isRegister) {
    const { email, password, name, salaryDay, remember } = await readCredentials(request, isRegister);
    if (isRegister && [...password].length < 15) throw new HttpError(400, 'invalid_input');

    const now = Date.now();
    const bucket = Math.floor(now / WINDOW_MS);
    const ip = secure ? request.headers['x-vercel-forwarded-for'] : request.socket.remoteAddress;
    const scopes = [
      ['email:' + tokenHash(email), MAX_ATTEMPTS],
      ['network:' + tokenHash(typeof ip === 'string' ? ip : 'unknown'), 48],
      ['global', 240],
    ];
    if (activeHashes >= 4 || !await store.recordAttempt(bucket, scopes) || activeHashes >= 4) {
      response.setHeader('Retry-After', Math.ceil(((bucket + 1) * WINDOW_MS - now) / 1000));
      throw new HttpError(429, 'too_many_attempts');
    }

    const found = isRegister ? null : await store.getUser(email);
    const user = found?.password_enabled === false ? null : found;
    const salt = isRegister ? randomBytes(16) : user?.password_salt ?? DUMMY_SALT;
    let hash;
    if (activeHashes >= 4) throw new HttpError(429, 'too_many_attempts');
    activeHashes++;
    try {
      hash = await hashPassword(password, salt);
    } finally {
      activeHashes--;
    }

    if (isRegister) {
      const id = await store.addUser(email, salt, hash, name, salaryDay);
      if (!id) throw new HttpError(409, 'email_unavailable');
      return json(response, 201, { user: account(id, email, name, salaryDay) });
    }

    if (!timingSafeEqual(hash, user?.password_hash ?? DUMMY_HASH) || !user) {
      throw new HttpError(401, 'invalid_credentials');
    }
    const token = randomBytes(32).toString('base64url');
    const duration = remember === true ? 30 * 24 * 60 * 60 : SESSION_SECONDS;
    const hashToken = tokenHash(token);
    await store.rotateSession(hashToken, user.id, now + duration * 1000, sessionHash(request), now);
    const profile = await store.getSession(hashToken, Date.now());
    if (!profile) throw new HttpError(401, 'unauthenticated');
    response.setHeader('Set-Cookie', cookieHeaders(token, remember === false ? null : duration, secure));
    return json(response, 200, { user: userProfile(profile, Boolean(secure && google)) });
  }

  async function startGoogle(request, response, link) {
    if (!secure || !google) {
      if (link) throw new HttpError(503, 'google_unavailable');
      return redirect(response, failure);
    }
    if (link) {
      await readJson(request);
      await requireSession(request);
    } else if (!['same-origin', 'none', undefined].includes(request.headers['sec-fetch-site'])) {
      return redirect(response, failure);
    }
    const now = Date.now();
    const ip = request.headers['x-vercel-forwarded-for'];
    const network = typeof ip === 'string' ? ip : 'unknown';
    if (!await store.recordAttempt(Math.floor(now / WINDOW_MS), [['google-network:' + tokenHash(network), 48]])) {
      if (link) throw new HttpError(429, 'too_many_attempts');
      return redirect(response, failure);
    }
    const flow = newFlow();
    await store.startGoogleFlow(flow.hash, flow.expires, link ? sessionHash(request) : null, now);
    const url = google.authorize(flow.verifier);
    if (!link) return redirect(response, url, [flowCookie(flow.verifier)]);
    response.setHeader('Set-Cookie', flowCookie(flow.verifier));
    return json(response, 200, { url });
  }

  async function completeGoogle(request, response, params) {
    const cookies = [flowCookie('', 0)];
    try {
      const verifier = readFlow(request);
      if (!secure || !google || !verifier) return redirect(response, failure, cookies);
      const flow = await store.consumeGoogleFlow(challenge(verifier), Date.now());
      const previous = sessionHash(request);
      const [code, ...duplicates] = params.getAll('code');
      if (!flow || !code || code.length > 512 || duplicates.length || params.has('error')
          || (flow.session_hash && previous && flow.session_hash !== previous)) {
        return redirect(response, failure, cookies);
      }
      const identity = await google.identity(code, verifier);
      if (!identity) return redirect(response, failure, cookies);
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      const error = await store.signInWithGoogle(identity, flow.session_hash, previous, {
        hash: tokenHash(token), now, expires: now + SESSION_SECONDS * 1000,
        salt: randomBytes(16), unusableHash: randomBytes(64),
      });
      if (error) return redirect(response, '/?auth_error=' + error + '#login', cookies);
      return redirect(response, '/#painel', [...cookies, ...cookieHeaders(token, SESSION_SECONDS, true)]);
    } catch {
      console.error('Falha ao concluir autenticação Google');
      return redirect(response, failure, cookies);
    }
  }

  return async (request, response) => {
    try {
      const [originalPath, search = ''] = request.url.split('?', 2);
      const params = new URLSearchParams(search);
      const target = params.get('__route');
      const pathname = secure && originalPath === '/api/index' && target
        ? '/api/' + target.replace(/^\/+/, '') : originalPath;
      const origin = expectedOrigin ?? 'http://127.0.0.1:' + request.socket.localPort;
      if (!secure && request.headers.host !== new URL(origin).host) throw new HttpError(403, 'host_not_allowed');
      const route = request.method + ' ' + pathname;

      const deleteTransaction = request.method === 'DELETE' && pathname.startsWith('/api/transactions/');
      const downloadReceipt = request.method === 'GET' && pathname.startsWith('/api/transactions/')
        && pathname.endsWith('/receipt');
      const updateTransaction = request.method === 'PATCH' && pathname.startsWith('/api/transactions/');
      const jsonPost = route.startsWith('POST /api/auth/') || route === 'POST /api/transactions' || updateTransaction;
      const accountMutation = route === 'PATCH /api/auth/profile' || route === 'DELETE /api/user/account';
      if (jsonPost || deleteTransaction || accountMutation) {
        if ((secure || request.headers.origin !== undefined) && request.headers.origin !== origin) {
          throw new HttpError(403, 'origin_not_allowed');
        }
        const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
        if ((jsonPost || accountMutation) && type !== 'application/json') throw new HttpError(415, 'json_required');
      }

      if (deleteTransaction || downloadReceipt || updateTransaction) {
        const user = await requireSession(request);
        const rawId = pathname.slice('/api/transactions/'.length, downloadReceipt ? -'/receipt'.length : undefined);
        const id = Number(rawId);
        if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id)) {
          throw new HttpError(400, 'invalid_transaction');
        }
        if (postgres && id > 2147483647) throw new HttpError(404, 'not_found');
        if (updateTransaction) {
          const body = await readJson(request, maxBody);
          enforceReceiptLimit(body);
          const { id: userId } = await requireSession(request);
          const item = await transactions.update(userId, id, body, maxAmount);
          if (item === undefined) throw new HttpError(404, 'not_found');
          if (item === null) throw new HttpError(400, 'invalid_transaction');
          return json(response, 200, { item });
        }
        if (downloadReceipt) {
          const receipt = await transactions.receipt(user.id, id);
          if (!receipt) throw new HttpError(404, 'not_found');
          const filename = encodeURIComponent(receipt.name)
            .replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16));
          return response.writeHead(200, {
            'Content-Type': receipt.mimeType,
            'Content-Disposition': "attachment; filename*=UTF-8''" + filename,
            'Content-Length': receipt.bytes.length,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          }).end(receipt.bytes);
        }
        if (!await transactions.remove(user.id, id)) throw new HttpError(404, 'not_found');
        return response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      }

      switch (route) {
        case 'GET /api/auth/google':
          try {
            return await startGoogle(request, response, false);
          } catch {
            console.error('Falha ao iniciar autenticação Google');
            return redirect(response, failure);
          }
        case 'POST /api/auth/google/link':
          return await startGoogle(request, response, true);
        case 'GET ' + callbackPath:
          return await completeGoogle(request, response, params);
        case 'POST /api/auth/register':
          return await authenticate(request, response, true);
        case 'POST /api/auth/login':
          return await authenticate(request, response, false);
        case 'GET /api/auth/session':
          return json(response, 200, { user: await requireSession(request) });
        case 'PATCH /api/auth/profile': {
          const user = await requireSession(request);
          const body = await readJson(request);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_profile');
          const { expectedUserId, ...fields } = body;
          confirmAccount(user, expectedUserId);
          const updates = profileUpdates(fields);
          if (!updates) throw new HttpError(400, 'invalid_profile');
          const updated = await store.updateProfile(sessionHash(request), Date.now(), updates);
          if (!updated) throw new HttpError(401, 'unauthenticated');
          return json(response, 200, { user: userProfile(updated, Boolean(secure && google)) });
        }
        case 'DELETE /api/user/account': {
          const user = await requireSession(request);
          const body = await readJson(request);
          if (body?.confirm !== true) throw new HttpError(400, 'confirmation_required');
          confirmAccount(user, body.expectedUserId);
          if (Object.keys(body).length !== 2) throw new HttpError(400, 'invalid_account');
          if (!await store.purgeUser(sessionHash(request), Date.now())) {
            throw new HttpError(401, 'unauthenticated');
          }
          return response.writeHead(204, {
            'Set-Cookie': [...cookieHeaders('', 0, secure), ...(secure ? [flowCookie('', 0)] : [])],
            'Cache-Control': 'no-store',
          }).end();
        }
        case 'POST /api/auth/logout':
          await store.deleteSession(sessionHash(request));
          return response.writeHead(204, {
            'Set-Cookie': cookieHeaders('', 0, secure), 'Cache-Control': 'no-store',
          }).end();
        case 'GET /api/transactions': {
          const { id } = await requireSession(request);
          return json(response, 200, { items: await transactions.list(id) });
        }
        case 'POST /api/transactions': {
          await requireSession(request);
          const body = await readJson(request, maxBody);
          enforceReceiptLimit(body);
          const fields = transactionFields(body);
          const { id } = await requireSession(request);
          if (!fields || fields.amount > maxAmount) throw new HttpError(400, 'invalid_transaction');
          return json(response, 201, { item: await transactions.create(id, fields) });
        }
      }

      const asset = !secure && request.method === 'GET' && assets.get(pathname);
      if (!asset) throw new HttpError(404, 'not_found');
      const content = await readFile(join(ROOT, asset[0]));
      return response.writeHead(200, {
        'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      }).end(content);
    } catch (error) {
      if (error instanceof HttpError) {
        if (!secure && error.status === 413) response.setHeader('Connection', 'close');
        return json(response, error.status, { error: error.message });
      }
      if (error.code === 'ENOENT') return json(response, 404, { error: 'not_found' });
      console.error('Falha no servidor de autenticação:', error.code ?? error.name);
      return json(response, 500, { error: 'internal_error' });
    }
  };

  function enforceReceiptLimit(body) {
    const base64 = body?.receipt?.dataBase64;
    if (secure && typeof base64 === 'string' && Buffer.byteLength(base64, 'base64') > HOSTED_MAX_RECEIPT) {
      throw new HttpError(413, 'body_too_large');
    }
  }
}

async function start({
  databasePath = join(__dirname, '.local', 'auth.sqlite'), port = 4174,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  if (process.env.VERCEL) throw new Error('Use the Vercel API handler');
  const usePostgres = databaseUrl !== undefined;
  const store = usePostgres
    ? await require('./postgres.cjs').postgresStore(databaseUrl, process.env.DATABASE_CA_CERT)
    : await sqliteStore(databasePath);
  try {
    await store.check?.();
  } catch (error) {
    await store.close();
    throw error;
  }
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 },
    createHandler(store, { postgres: usePostgres }));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    await store.close();
    throw error;
  }
  server.on('close', () => {
    Promise.resolve(store.close()).catch(error => console.error('Database close failed:', error.code ?? error.name));
  });
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}

if (require.main === module) {
  start({
    port: Number(process.env.FINFLOW_AUTH_PORT ?? 4174),
    databasePath: process.env.FINFLOW_DATABASE_PATH,
  })
    .then(({ url }) => console.log('FinFlow local: ' + url))
    .catch(error => {
      console.error(error.code ?? error.name);
      process.exitCode = 1;
    });
}

module.exports = { start, createHandler, json };
