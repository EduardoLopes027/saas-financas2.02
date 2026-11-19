'use strict';

const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { readFile, mkdir } = require('node:fs/promises');
const { createServer } = require('node:http');
const { dirname, join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { promisify } = require('node:util');
const { transactionFields, transactionStore } = require('./transactions.cjs');

const deriveKey = promisify(scrypt);
const COOKIE = 'finflow_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 12;
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
  ["/assets/js/app.js",["assets/js/app.js","text/javascript; charset=utf-8"]],
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

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 4096) throw new HttpError(413, 'body_too_large');
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

function cookieHeaders(token, maxAge) {
  return [
    COOKIE + '=' + token + '; Path=/api; HttpOnly; SameSite=Strict' + (maxAge === null ? '' : '; Max-Age=' + maxAge),
    COOKIE + '=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0',
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

async function start({ databasePath = join(__dirname, '.local', 'auth.sqlite'), port = 4174 } = {}) {
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
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  const getUser = db.prepare('SELECT * FROM users WHERE email = ?');
  const addUser = db.prepare('INSERT INTO users(email, password_salt, password_hash, name, salary_day) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING');
  const getSession = db.prepare(`
    SELECT users.id, users.email, users.name, users.salary_day AS salaryDay FROM sessions JOIN users ON users.id = sessions.user_id
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
  let activeHashes = 0;

  function account(id, email, name, salaryDay) {
    return { id, email, ...(name && { name }), ...(salaryDay && { salaryDay }) };
  }

  function requireSession(request) {
    const user = getSession.get(sessionHash(request), Date.now());
    if (!user) throw new HttpError(401, 'unauthenticated');
    return account(user.id, user.email, user.name, user.salaryDay);
  }

  async function authenticate(request, response, isRegister) {
    const { email, password, name, salaryDay, remember } = await readCredentials(request, isRegister);
    if (isRegister && [...password].length < 15) throw new HttpError(400, 'invalid_input');

    const now = Date.now();
    const bucket = Math.floor(now / WINDOW_MS);
    clearAttempts.run(bucket);
    if (activeHashes >= 4 || !recordAttempt.get(bucket, MAX_ATTEMPTS)) {
      response.setHeader('Retry-After', Math.ceil(((bucket + 1) * WINDOW_MS - now) / 1000));
      throw new HttpError(429, 'too_many_attempts');
    }

    const user = isRegister ? null : getUser.get(email);
    const salt = isRegister ? randomBytes(16) : user?.password_salt ?? DUMMY_SALT;
    let hash;
    activeHashes++;
    try {
      hash = await hashPassword(password, salt);
    } finally {
      activeHashes--;
    }

    if (isRegister) {
      const result = addUser.run(email, salt, hash, name ?? null, salaryDay ?? null);
      if (!result.changes) throw new HttpError(409, 'email_unavailable');
      return json(response, 201, { user: account(result.lastInsertRowid, email, name, salaryDay) });
    }

    if (!timingSafeEqual(hash, user?.password_hash ?? DUMMY_HASH) || !user) {
      throw new HttpError(401, 'invalid_credentials');
    }
    const token = randomBytes(32).toString('base64url');
    deleteExpired.run(now);
    const duration = remember === true ? 30 * 24 * 60 * 60 : SESSION_SECONDS;
    addSession.run(tokenHash(token), user.id, now + duration * 1000);
    deleteSession.run(sessionHash(request));
    response.setHeader('Set-Cookie', cookieHeaders(token, remember === false ? null : duration));
    return json(response, 200, { user: account(user.id, email, user.name, user.salary_day) });
  }

  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    try {
      const pathname = request.url.split('?')[0];
      const expectedHost = '127.0.0.1:' + server.address().port;
      if (request.headers.host !== expectedHost) throw new HttpError(403, 'host_not_allowed');
      const route = request.method + ' ' + pathname;

      const deleteTransaction = request.method === 'DELETE' && pathname.startsWith('/api/transactions/');
      const jsonPost = route.startsWith('POST /api/auth/') || route === 'POST /api/transactions';
      if (jsonPost || deleteTransaction) {
        const origin = request.headers.origin;
        if (origin !== undefined && origin !== 'http://' + expectedHost) {
          throw new HttpError(403, 'origin_not_allowed');
        }
        const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
        if (jsonPost && type !== 'application/json') throw new HttpError(415, 'json_required');
      }

      if (deleteTransaction) {
        const user = requireSession(request);
        const rawId = pathname.slice('/api/transactions/'.length);
        const id = Number(rawId);
        if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id)) {
          throw new HttpError(400, 'invalid_transaction');
        }
        if (!transactions.remove(user.id, id)) throw new HttpError(404, 'not_found');
        return response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      }

      switch (route) {
        case 'POST /api/auth/register':
          return await authenticate(request, response, true);
        case 'POST /api/auth/login':
          return await authenticate(request, response, false);
        case 'GET /api/auth/session':
          return json(response, 200, { user: requireSession(request) });
        case 'POST /api/auth/logout':
          deleteSession.run(sessionHash(request));
          return response.writeHead(204, {
            'Set-Cookie': cookieHeaders('', 0), 'Cache-Control': 'no-store',
          }).end();
        case 'GET /api/transactions': {
          const { id } = requireSession(request);
          return json(response, 200, { items: transactions.list(id) });
        }
        case 'POST /api/transactions': {
          requireSession(request);
          const fields = transactionFields(await readJson(request));
          const { id } = requireSession(request);
          if (!fields) throw new HttpError(400, 'invalid_transaction');
          return json(response, 201, { item: transactions.create(id, fields) });
        }
      }

      const asset = request.method === 'GET' && assets.get(pathname);
      if (!asset) throw new HttpError(404, 'not_found');
      const content = await readFile(join(ROOT, asset[0]));
      return response.writeHead(200, {
        'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      }).end(content);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 413) response.setHeader('Connection', 'close');
        return json(response, error.status, { error: error.message });
      }
      if (error.code === 'ENOENT') return json(response, 404, { error: 'not_found' });
      console.error('Falha no servidor de autenticação:', error.code ?? error.name);
      return json(response, 500, { error: 'internal_error' });
    }
  });

  server.on('close', () => db.close());
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    db.close();
    throw error;
  }
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}

if (require.main === module) {
  start({ port: Number(process.env.FINFLOW_AUTH_PORT ?? 4174) })
    .then(({ url }) => console.log('FinFlow local: ' + url))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { start };
