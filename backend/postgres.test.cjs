'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const { X509Certificate } = require('node:crypto');
const { rootCertificates } = require('node:tls');
const test = require('node:test');
const { createHandler } = require('./auth.cjs');
const { googleClient, challenge } = require('./google-oauth.cjs');
const { recoveryClient } = require('./recovery.cjs');

const dependencyRoot = process.env.FINFLOW_PGLITE_DIR;
const origin = 'https://finflow.example.test';

test('A função da Vercel registra a causa do 503 sem expor credenciais e permite nova tentativa', async t => {
  const log = t.mock.method(console, 'error', () => {});
  const previous = process.env;
  process.env = { ...previous, APP_ORIGIN: origin };
  delete process.env.DATABASE_URL;
  t.after(() => { process.env = previous; });
  const server = createServer(require('../api/index.js'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api/auth/session';
  const first = await fetch(endpoint);
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), { error: 'service_unavailable' });
  assert.match(log.mock.calls[0].arguments[0], /\[DATABASE_URL_MISSING\]/);

  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  process.env.DATABASE_URL = 'postgres://test:senha-ficticia-secreta@127.0.0.1:' + port + '/postgres';
  delete process.env.DATABASE_CA_CERT;
  const second = await fetch(endpoint);
  assert.equal(second.status, 503);
  assert.match(log.mock.calls[1].arguments[0], /\[ECONNREFUSED\]/);
  assert.doesNotMatch(JSON.stringify(log.mock.calls.map(call => call.arguments)), /senha-ficticia-secreta/);
});

test('Vercel recovery activates with Supabase configuration and fails closed without it', async t => {
  const postgres = require('./postgres.cjs');
  const apiModule = require.resolve('../api/index.js');
  const requestContext = Symbol.for('@vercel/request-context');
  const originalContext = globalThis[requestContext];
  const originalEnv = process.env;
  const httpFetch = globalThis.fetch;
  const deferred = [];
  const requests = [];
  let attempt;
  let grant;
  const email = 'recovery@example.test';
  const providerId = '3736b722-f5ab-4baf-bcc2-6fe062145a61';
  const code = '3afd3bf9-5c4f-45d5-9654-26574547433c';

  t.after(() => {
    process.env = originalEnv;
    if (originalContext === undefined) delete globalThis[requestContext];
    else globalThis[requestContext] = originalContext;
    delete require.cache[apiModule];
  });
  globalThis[requestContext] = { get: () => ({ waitUntil: promise => deferred.push(promise) }) };
  t.mock.method(postgres, 'postgresStore', async () => ({
    check: async () => {},
    recordAttempt: async () => true,
    async startRecovery(address, stateHash, verifier) {
      if (address !== email) return false;
      attempt = { stateHash, verifier, email };
      return true;
    },
    async consumeRecovery(stateHash) {
      if (attempt?.stateHash !== stateHash) return undefined;
      const consumed = attempt;
      attempt = undefined;
      return consumed;
    },
    async issueRecoveryGrant(attempt, identity, hash, publicId) {
      assert.equal(attempt.email, email);
      assert.deepEqual(identity, { id: providerId, email, subject: null });
      grant = { hash, public_id: publicId, email };
      return true;
    },
    async getRecoveryGrant(hash) {
      return hash === grant?.hash ? grant : undefined;
    },
  }));

  let callbackUrl;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, 'https://supabase.example.test');
    assert.equal(options.headers.apikey, 'fictitious-public-key');
    const body = JSON.parse(options.body);
    requests.push(endpoint.pathname);
    if (endpoint.pathname === '/auth/v1/recover') {
      assert.equal(body.email, email);
      assert.equal(body.code_challenge_method, 's256');
      assert.equal(body.code_challenge, challenge(attempt.verifier));
      callbackUrl = new URL(endpoint.searchParams.get('redirect_to'));
      assert.equal(callbackUrl.origin, origin);
      assert.equal(callbackUrl.pathname, '/api/auth/recovery/callback');
      assert.match(callbackUrl.searchParams.get('state'), /^[\w-]{43}$/);
      // GoTrue appends code to the original redirect query after email verification.
      callbackUrl.searchParams.set('code', code);
      return Response.json({});
    }
    assert.equal(endpoint.pathname + endpoint.search, '/auth/v1/token?grant_type=pkce');
    assert.equal(body.auth_code, code);
    assert.equal(typeof body.code_verifier, 'string');
    const claims = Buffer.from(JSON.stringify({ sub: providerId, amr: [{ method: 'recovery', timestamp: 1795651200 }] }))
      .toString('base64url');
    return Response.json({
      user: { id: providerId, email, email_confirmed_at: '2026-11-20T00:00:00Z' },
      access_token: 'header.' + claims + '.signature',
    });
  });
  t.mock.method(console, 'error', () => {});

  async function withVercel(configuration, run) {
    process.env = { ...originalEnv, APP_ORIGIN: origin };
    for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'PASSWORD_RECOVERY_ENABLED']) {
      delete process.env[name];
    }
    Object.assign(process.env, configuration);
    delete require.cache[apiModule];
    const server = createServer(require(apiModule));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = 'http://127.0.0.1:' + server.address().port;
    try {
      await run((path, options) => httpFetch(local + path, { redirect: 'manual', ...options }));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  async function forgot(request, address = email, browserOrigin = origin) {
    const response = await request('/api/index?__route=auth/forgot-password', {
      method: 'POST', headers: { Origin: browserOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address, redirect_to: 'https://untrusted.example.test' }),
    });
    await Promise.all(deferred.splice(0));
    return response;
  }

  await withVercel({
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'fictitious-public-key',
  }, async request => {
    assert.equal((await forgot(request, email, 'https://untrusted.example.test')).status, 403);
    const unknown = await forgot(request, 'unknown@example.test');
    assert.equal(unknown.status, 202);
    assert.deepEqual(await unknown.json(), { ok: true });
    assert.deepEqual(requests, []);
    const accepted = await forgot(request);
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { ok: true });
    const query = new URLSearchParams(callbackUrl.searchParams);
    query.set('__route', 'auth/recovery/callback');
    const callback = await request('/api/index?' + query);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), '/#redefinir-senha');
    const raw = callback.headers.getSetCookie()[0];
    assert.match(raw, /^__Host-finflow_recovery=.+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=300$/);
    const ready = await request('/api/index?__route=auth/reset-password', { headers: { Cookie: raw.split(';')[0] } });
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ok: true, attemptId: grant.public_id, maskedEmail: 'r***@example.test' });
    const replay = await request('/api/index?' + query);
    assert.equal(replay.headers.get('location'), '/?auth_error=recovery_failed#login');
    assert.deepEqual(requests, ['/auth/v1/recover', '/auth/v1/token']);
  });

  await withVercel({
    SUPABASE_URL: ' https://supabase.example.test ',
    SUPABASE_PUBLISHABLE_KEY: '  ',
    SUPABASE_ANON_KEY: ' fictitious-public-key ',
    PASSWORD_RECOVERY_ENABLED: 'false',
  }, async request => {
    assert.equal((await forgot(request)).status, 202);
    assert.equal(requests.at(-1), '/auth/v1/recover');
    assert.equal(requests.length, 3);
  });

  for (const configuration of [
    { SUPABASE_URL: 'https://supabase.example.test' },
    { SUPABASE_PUBLISHABLE_KEY: 'fictitious-public-key' },
    { SUPABASE_URL: 'http://supabase.example.test', SUPABASE_PUBLISHABLE_KEY: 'fictitious-public-key' },
  ]) {
    await withVercel(configuration, async request => {
      const response = await forgot(request);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'recovery_unavailable' });
      assert.equal((await request('/api/index?__route=auth/reset-password')).status, 401);
    });
  }
  assert.equal(requests.length, 3);
});

test('Configura o pooler com TLS verificado e reconstrói certificados PEM', () => {
  const { connectionOptions } = require('./postgres.cjs');
  const url = 'postgresql://finflow_app.project:abc%40%2F%25@aws-0-region.pooler.supabase.com:6543/postgres'
    + '?sslmode=require&prepare=true';
  const pem = rootCertificates[0].trim();
  for (const ca of [pem, pem.replace(/\n/g, '\\n'), pem.replace(/\n/g, ' '), pem.replace(/\n/g, '')]) {
    const options = connectionOptions(url, ca);
    assert.equal(options.port, 6543);
    assert.equal(options.username, 'finflow_app.project');
    assert.equal(options.password, 'abc@/%');
    assert.equal(options.database, 'postgres');
    assert.equal(options.prepare, false);
    assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca: [new X509Certificate(pem).toString()] });
  }
  assert.throws(() => connectionOptions(url, 'invalid'), { code: 'DATABASE_CA_CERT_INVALID' });
  assert.throws(() => connectionOptions(url.replace('.project:', ':')), { code: 'DATABASE_POOLER_USER_INVALID' });
  assert.throws(() => connectionOptions(url.replace('require', 'disable')), { code: 'DATABASE_SSLMODE_INVALID' });
  assert.throws(() => connectionOptions(url.replace('%40', '%ZZ')), { code: 'DATABASE_URL_INVALID' });
});

test('PostgreSQL descartável com papel restrito: autenticação, Google OAuth, lançamentos e recorrência', {
  skip: !dependencyRoot && 'Defina FINFLOW_PGLITE_DIR para executar o teste com PostgreSQL em memória',
}, async t => {
  const { default: postgres } = require('postgres');
  const { createStore } = require('./postgres.cjs');
  const requireTestDependency = createRequire(join(dependencyRoot, 'package.json'));
  const { PGlite } = requireTestDependency('@electric-sql/pglite');
  const { PGLiteSocketServer } = requireTestDependency('@electric-sql/pglite-socket');
  const db = await PGlite.create();
  let socket;
  let store;
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await store?.close();
    await socket?.stop();
    await db.close();
  });
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const schema = (await readFile(join(__dirname, '../supabase/schema.sql'), 'utf8')).replace(/\r\n/g, '\n');
  const avatarMigration = await readFile(join(__dirname, '../supabase/migrations/20261127000000_account_avatar.sql'), 'utf8');
  const migration = await readFile(join(__dirname, '../supabase/migrations/20261126000000_account_settings.sql'), 'utf8');
  const profileStart = schema.indexOf('ALTER TABLE finflow_private.users\n  ADD COLUMN IF NOT EXISTS phone');
  assert.ok(profileStart > 0);
  await db.exec(schema.slice(0, profileStart) + 'COMMIT;');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(avatarMigration);
  await db.exec(avatarMigration);
  const recoveryMigration = await readFile(join(__dirname, '../supabase/migrations/20261127010000_password_recovery.sql'), 'utf8');
  await db.exec(recoveryMigration);
  await db.exec(recoveryMigration);
  await db.exec(schema);
  const [permissions] = (await db.query(`
    SELECT has_schema_privilege('anon','finflow_private','USAGE') AS anon,
      has_schema_privilege('authenticated','finflow_private','USAGE') AS authenticated,
      has_table_privilege('finflow_runtime','finflow_private.transactions','UPDATE') AS runtime
  `)).rows;
  assert.deepEqual(permissions, { anon: false, authenticated: false, runtime: true });

  socket = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await socket.start();
  const sql = postgres(`postgres://postgres@${socket.getServerConn()}/postgres`, {
    max: 1, prepare: false, fetch_types: false, connect_timeout: 5,
  });
  store = createStore(sql);
  await sql.unsafe('SET ROLE finflow_runtime');
  assert.equal((await sql.unsafe('SELECT current_user AS role'))[0].role, 'finflow_runtime');
  const codes = new Map();
  const tokens = new Map();
  const google = googleClient('https://supabase.example.test', 'publishable-test', origin, async (url, options) => {
    assert.equal(options.headers.apikey, 'publishable-test');
    if (url.endsWith('/token?grant_type=pkce')) {
      const { auth_code: code, code_verifier: verifier } = JSON.parse(options.body);
      const flow = codes.get(code);
      if (!flow || flow.challenge !== challenge(verifier)) return new Response(null, { status: 400 });
      codes.delete(code);
      tokens.set(code, flow.profile);
      return Response.json({ access_token: code });
    }
    assert.equal(url, 'https://supabase.example.test/auth/v1/user');
    const profile = tokens.get(options.headers.Authorization.slice('Bearer '.length));
    return Response.json({ identities: [{ provider: 'google', identity_data: profile }] });
  });
  const mails = new Map();
  let recoveryCode = 0;
  const recovery = recoveryClient('https://supabase.example.test', 'publishable-test', origin, async (url, options) => {
    const endpoint = new URL(url);
    const input = JSON.parse(options.body);
    assert.equal(options.headers.apikey, 'publishable-test');
    if (endpoint.pathname === '/auth/v1/recover') {
      assert.equal(input.code_challenge_method, 's256');
      const callback = new URL(endpoint.searchParams.get('redirect_to'));
      assert.equal(callback.origin, origin);
      assert.equal(callback.pathname, '/api/auth/recovery/callback');
      mails.set(input.email, { state: callback.searchParams.get('state'), challenge: input.code_challenge });
      return Response.json({});
    }
    assert.equal(endpoint.pathname + endpoint.search, '/auth/v1/token?grant_type=pkce');
    const flow = codes.get(input.auth_code);
    if (!flow?.user || flow.challenge !== challenge(input.code_verifier)) return new Response(null, { status: 400 });
    codes.delete(input.auth_code);
    const claims = Buffer.from(JSON.stringify({ sub: flow.user.id, amr: [{ method: flow.method ?? 'recovery' }] })).toString('base64url');
    return Response.json({ user: flow.user, access_token: 'header.' + claims + '.signature', refresh_token: 'not-for-browser' });
  });
  const handler = createHandler(store, { secure: true, postgres: true, expectedOrigin: origin, google, recovery });
  server = createServer(async (request, response) => {
    if (request.headers['x-test-vercel-helper']) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      Object.defineProperty(request, 'body', { get: () => JSON.parse(Buffer.concat(chunks).toString()) });
    }
    return handler(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = 'http://127.0.0.1:' + server.address().port;
  const api = (path, { method = 'GET', cookie, body, browserOrigin = origin, parsed = false, code, state } = {}) =>
    fetch(root + '/api/index?' + new URLSearchParams({ __route: path, ...(code && { code }), ...(state && { state }) }), {
      method,
      headers: {
        ...(browserOrigin && { Origin: browserOrigin }),
        ...(cookie && { Cookie: cookie }),
        ...(body && { 'Content-Type': 'application/json' }),
        ...(parsed && { 'X-Test-Vercel-Helper': '1' }),
      },
      redirect: 'manual',
      body: body && JSON.stringify(body),
    });
  async function account(email) {
    const body = { email, password: 'senha fictícia e longa' };
    const register = () => api('auth/register', { method: 'POST', body, parsed: true });
    assert.equal((await register()).status, 201);
    assert.equal((await register()).status, 409);
    const login = await api('auth/login', { method: 'POST', body, parsed: true });
    assert.equal(login.status, 200);
    assert.match(login.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict; Secure/);
    return login.headers.getSetCookie()[0].split(';')[0];
  }
  const a = await account('primeira@example.test');
  const b = await account('segunda@example.test');
  assert.equal((await api('auth/session', { cookie: a })).status, 200);
  assert.equal((await api('auth/logout', { cookie: a, method: 'POST', body: {}, browserOrigin: null })).status, 403);

  const bytes = Buffer.from('%PDF-1.4\n%%EOF\n');
  const receipt = { name: 'teste.pdf', mimeType: 'application/pdf', dataBase64: bytes.toString('base64') };
  const base = { type: 'Despesa', category: 'Moradia', date: '2024-01-31', amount: 1000 };
  const create = (fields, cookie = a) => api('transactions', { method: 'POST', cookie, body: { ...base, ...fields } });
  const oversized = { ...receipt, dataBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') };
  assert.equal((await create({ receipt: oversized })).status, 413);
  const added = await create({ installments: 3, receipt });
  assert.equal(added.status, 201);
  const { item: first } = await added.json();
  const path = 'transactions/' + first.id;
  const patch = (cookie, body) => api(path, { method: 'PATCH', cookie, body });
  const list = async cookie => {
    const response = await api('transactions', { cookie });
    assert.equal(response.status, 200);
    return (await response.json()).items;
  };
  assert.deepEqual((await list(a)).map(item => [item.amount, item.date]), [
    [333, '2024-03-31'], [333, '2024-02-29'], [334, '2024-01-31'],
  ]);
  assert.deepEqual(await list(b), []);
  assert.equal((await patch(b, { amount: 1 })).status, 404);
  assert.equal((await api(path + '/receipt', { cookie: b })).status, 404);
  assert.equal((await api(path, { method: 'DELETE', cookie: b })).status, 404);
  const download = await api(path + '/receipt', { cookie: a });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const changed = await patch(a, { amount: 999999999999, date: '2024-01-30', notes: '' });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).item.amount, 999999999999);
  assert.equal((await patch(a, { amount: 1000000000000 })).status, 400);
  assert.equal((await patch(a, { receipt: null })).status, 200);
  assert.equal((await api(path + '/receipt', { cookie: a })).status, 404);

  const { user } = await (await api('auth/session', { cookie: a })).json();
  const recurring = await create({ recurrence: 'Mensal', date: '2096-01-31', paymentMethod: 'Pix' });
  assert.equal(recurring.status, 201);
  const until = '2096-03-31';
  const dates = async () => (await store.transactions.list(user.id, until))
    .filter(item => item.recurrence).map(item => item.date);
  assert.deepEqual(await dates(), ['2096-03-31', '2096-02-29', '2096-01-31']);
  assert.deepEqual(await dates(), ['2096-03-31', '2096-02-29', '2096-01-31']);
  assert.equal((await api(path, { method: 'DELETE', cookie: a })).status, 204);
  assert.equal((await api(path, { method: 'DELETE', cookie: a })).status, 404);
  assert.equal((await api('auth/logout', { method: 'POST', cookie: a, body: { expectedUserId: user.id } })).status, 204);
  assert.equal((await api('auth/session', { cookie: a })).status, 401);
  assert.equal((await api('auth/session', { cookie: b })).status, 200);

  const beginLink = (cookie, browserOrigin = origin) =>
    api('auth/google/link', { method: 'POST', body: {}, cookie, browserOrigin });
  const finish = (cookie, code) => api('auth/google/callback', { cookie, code });
  const session = cookie => api('auth/session', { cookie });
  const oauthCookie = response => response.headers.getSetCookie()[0].split(';')[0];
  const newSession = response => response.headers.getSetCookie()[1].split(';')[0];

  async function authorize(profile, cookie) {
    const response = cookie ? await beginLink(cookie) : await api('auth/google');
    assert.equal(response.status, cookie ? 200 : 303);
    assert.match(response.headers.getSetCookie()[0], /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=300/);
    const url = new URL(cookie ? (await response.json()).url : response.headers.get('location'));
    assert.equal(url.origin, 'https://supabase.example.test');
    assert.equal(url.pathname, '/auth/v1/authorize');
    assert.equal(url.searchParams.get('provider'), 'google');
    assert.equal(url.searchParams.get('redirect_to'), origin + '/api/auth/google/callback');
    assert.equal(url.searchParams.get('code_challenge_method'), 's256');
    const code = 'fictitious-code-' + (codes.size + tokens.size);
    codes.set(code, { profile, challenge: url.searchParams.get('code_challenge') });
    return [oauthCookie(response), code];
  }

  const profile = {
    sub: 'google-1', email: 'nova@example.test', email_verified: true, name: 'Conta ficticia',
    picture: 'https://lh3.googleusercontent.com/a/test-avatar',
  };
  const failed = '/?auth_error=google_failed#login';
  assert.equal((await finish(undefined, 'missing')).headers.get('location'), failed);
  const unrelated = await authorize(profile);
  const original = await authorize(profile);
  assert.equal((await finish(unrelated[0], original[1])).headers.get('location'), failed);
  assert.equal((await finish(...await authorize({ ...profile, email_verified: false }))).headers.get('location'), failed);
  const firstFlow = await authorize(profile);
  const signedIn = await finish(...firstFlow);
  assert.equal(signedIn.headers.get('location'), '/#painel');
  assert.match(signedIn.headers.getSetCookie()[0], /Max-Age=0/);
  const googleUser = (await (await session(newSession(signedIn))).json()).user;
  assert.equal(googleUser.email, profile.email);
  assert.equal(googleUser.displayName, profile.name);
  assert.equal(googleUser.salaryDay, '5-business');
  assert.equal(googleUser.emailVerified, true);
  assert.equal(googleUser.googleAvatarUrl, profile.picture);
  assert.equal(googleUser.avatar_url, profile.picture);
  assert.ok(Date.parse(googleUser.googleLinkedAt));
  assert.equal((await finish(...firstFlow)).headers.get('location'), failed);
  const password = { email: profile.email, password: 'senha ficticia sem acesso' };
  assert.equal((await api('auth/login', { method: 'POST', body: password })).status, 401);
  const repeat = await finish(...await authorize({ ...profile, email: 'mudou@example.test' }));
  const changedIdentity = (await (await session(newSession(repeat))).json()).user;
  assert.equal(changedIdentity.id, googleUser.id);
  assert.equal(changedIdentity.emailVerified, false);
  assert.equal(changedIdentity.googleAvatarUrl, null);

  const existing = { ...profile, sub: 'google-2', email: 'segunda@example.test' };
  const collision = await finish(...await authorize(existing));
  assert.equal(collision.headers.get('location'), '/?auth_error=google_link_required#login');
  assert.equal((await beginLink(undefined)).status, 401);
  assert.equal((await beginLink(b, null)).status, 403);
  assert.equal((await beginLink(b, 'https://elsewhere.example.test')).status, 403);
  assert.equal((await finish(...await authorize({ ...existing, email: 'outro@example.test' }, b))).headers.get('location'), failed);
  const before = (await (await session(b)).json()).user;
  const entry = await create({ description: 'Lançamento anterior ao vínculo' }, b);
  assert.equal(entry.status, 201);
  const { item: existingItem } = await entry.json();
  const linked = await finish(...await authorize(existing, b));
  assert.equal(linked.headers.get('location'), '/#painel');
  assert.equal((await session(b)).status, 401);
  assert.equal((await (await session(newSession(linked))).json()).user.id, before.id);
  assert.deepEqual((await list(newSession(linked))).map(item => item.id), [existingItem.id]);
  assert.deepEqual(await list(newSession(repeat)), []);
  assert.equal((await api('transactions/' + existingItem.id, {
    method: 'PATCH', cookie: newSession(repeat), body: { amount: 1 },
  })).status, 404);
  const revokedFlow = await authorize(existing, newSession(linked));
  assert.equal((await api('auth/logout', { method: 'POST', cookie: newSession(linked), body: { expectedUserId: before.id } })).status, 204);
  assert.equal((await finish(...revokedFlow)).headers.get('location'), failed);

  const alive = newSession(await finish(...await authorize(existing)));
  const other = newSession(repeat);
  const updateProfile = (body, browserOrigin = origin) => api('auth/profile', {
    method: 'PATCH', body: { expectedUserId: before.id, ...body }, cookie: alive, browserOrigin,
  });
  assert.equal((await updateProfile({ theme: 'dark' }, null)).status, 403);
  assert.equal((await updateProfile({ email: 'outra@example.test' })).status, 400);
  assert.equal((await updateProfile({ expectedUserId: googleUser.id, theme: 'dark' })).status, 409);
  const preferences = { displayName: 'Updated', paydayRule: 'fixed', paydayDay: 31, theme: 'dark', amountMask: false };
  const update = await updateProfile(preferences);
  assert.equal(update.status, 200);
  const updated = (await update.json()).user;
  for (const [key, value] of Object.entries(preferences)) assert.equal(updated[key], value);
  assert.equal(updated.emailVerified, true);
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(updated.createdAt));
  assert.deepEqual((await (await session(alive)).json()).user, updated);
  assert.equal(updated.avatar_url, profile.picture);
  const patchAvatar = (cookie, avatar_url) => api('user/profile', {
    method: 'PATCH', body: { expectedUserId: googleUser.id, avatar_url }, cookie, parsed: true,
  });
  const image = await require('sharp')({ create: {
    width: 2, height: 2, channels: 3, background: '#ef3e5b',
  } }).png().toBuffer();
  const upload = await patchAvatar(other, 'data:image/png;base64,' + image.toString('base64'));
  assert.equal(upload.status, 200);
  assert.match((await upload.json()).user.avatar_url, /^data:image\/webp;base64,/);
  const custom = 'https://images.example.test/custom.webp';
  assert.equal((await patchAvatar(other, custom)).status, 200);
  const changedPicture = { ...profile, picture: 'https://lh3.googleusercontent.com/a/changed' };
  let returning = newSession(await finish(...await authorize(changedPicture)));
  assert.equal((await (await session(returning)).json()).user.avatar_url, custom);
  assert.equal((await patchAvatar(returning, null)).status, 200);
  returning = newSession(await finish(...await authorize(changedPicture)));
  const afterRemoval = (await (await session(returning)).json()).user;
  assert.equal(afterRemoval.avatar_url, null);
  assert.equal(afterRemoval.googleAvatarUrl, null);
  assert.equal(afterRemoval.googleLinked, true);
  assert.equal((await (await session(other)).json()).user.theme, 'light');

  assert.equal((await create({ recurrence: 'Mensal', receipt, paymentMethod: 'Pix' }, alive)).status, 201);
  const pendingLink = await authorize(existing, alive);
  const purge = (confirm, browserOrigin = origin, expectedUserId = before.id) => api('user/account', {
    method: 'DELETE', cookie: alive, body: { confirm, expectedUserId }, browserOrigin, parsed: true,
  });
  assert.equal((await purge(true, null)).status, 403);
  assert.equal((await purge(false)).status, 400);
  assert.equal((await purge(true, origin, googleUser.id)).status, 409);
  const deleted = await purge(true);
  assert.equal(deleted.status, 204);
  assert.equal(deleted.headers.getSetCookie().length, 3);
  assert.ok(deleted.headers.getSetCookie().every(cookie => cookie.includes('Max-Age=0')));
  assert.equal((await purge(true)).status, 401);
  assert.equal((await finish(...pendingLink)).headers.get('location'), failed);
  assert.equal((await session(other)).status, 200);

  const forgot = (email, browserOrigin = origin) => api('auth/forgot-password', {
    method: 'POST', body: { email, redirect_to: 'https://untrusted.example.test' }, browserOrigin,
  });
  const recoveryCallback = (state, code) => api('auth/recovery/callback', { state, code });
  const resetRoute = (cookie, body, browserOrigin = origin) => api('auth/reset-password', {
    cookie, body, browserOrigin, method: body ? 'POST' : 'GET',
  });
  const recover = async (email, identity) => {
    const sent = await forgot(email);
    assert.equal(sent.status, 202);
    assert.deepEqual(await sent.json(), { ok: true });
    const flow = mails.get(email);
    assert.ok(flow);
    const code = 'recovery-' + codes.size + '-' + ++recoveryCode;
    codes.set(code, { challenge: flow.challenge, user: identity });
    return { flow, code };
  };
  const startGrant = async (email, identity) => {
    const { flow, code } = await recover(email, identity);
    const response = await recoveryCallback(flow.state, code);
    assert.equal(response.headers.get('location'), '/#redefinir-senha');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const raw = response.headers.getSetCookie()[0];
    assert.match(raw, /^__Host-finflow_recovery=.+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=300$/);
    const cookie = raw.split(';')[0];
    const status = await resetRoute(cookie);
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.ok, true);
    assert.equal(body.maskedEmail, email[0] + '***@example.test');
    return { cookie, attemptId: body.attemptId, state: flow.state, code };
  };

  assert.equal((await forgot('primeira@example.test', null)).status, 403);
  for (const email of ['missing@example.test', 'primeira@example.test']) {
    const neutral = await forgot(email);
    assert.equal(neutral.status, 202);
    assert.deepEqual(await neutral.json(), { ok: true });
    assert.equal(mails.has(email), false);
  }
  assert.equal((await resetRoute()).status, 401);
  const native = { id: '3736b722-f5ab-4baf-bcc2-6fe062145a61', email: 'primeira@example.test',
    email_confirmed_at: '2026-11-01T00:00:00Z' };
  const googleRecovery = { id: '533cc4f0-03e9-4e7c-bfa0-939dfcbab1e6', email: profile.email,
    email_confirmed_at: native.email_confirmed_at, identities: [{ provider: 'google', identity_data: profile }] };
  const oldCredential = await store.getUser(native.email);
  const nativeLogin = await api('auth/login', { method: 'POST',
    body: { email: native.email, password: 'senha fict\u00edcia e longa' },
  });
  assert.equal(nativeLogin.status, 200);
  const nativeSession = nativeLogin.headers.getSetCookie()[0].split(';')[0];
  await sql.unsafe('RESET ROLE');
  await sql.unsafe('INSERT INTO finflow_private.recovery_identities (user_id,provider_user_id,verified_email) VALUES ($1,$2,$3)',
    [oldCredential.id, native.id, native.email]);
  await sql.unsafe('SET ROLE finflow_runtime');
  // Restore the exact verified Google mailbox after exercising the changed-email case above.
  const googleSession = newSession(await finish(...await authorize(profile)));
  assert.equal((await session(googleSession)).status, 200);
  const wrong = await recover(native.email, { ...native, id: googleRecovery.id });
  codes.get(wrong.code).method = 'oauth';
  const rejected = await recoveryCallback(wrong.flow.state, wrong.code);
  assert.equal(rejected.headers.get('location'), '/?auth_error=recovery_failed#login');
  const target = await startGrant(native.email, native);
  const exhausted = await forgot(native.email);
  assert.equal(exhausted.status, 202);
  assert.deepEqual(await exhausted.json(), { ok: true });
  assert.equal(mails.get(native.email).state, target.state);
  const swapped = await recover(profile.email, googleRecovery);
  const swappedResponse = await recoveryCallback(swapped.flow.state, target.code);
  assert.equal(swappedResponse.headers.get('location'), '/?auth_error=recovery_failed#login');
  const otherTarget = await startGrant(profile.email, googleRecovery);
  assert.equal((await resetRoute(otherTarget.cookie, { attemptId: target.attemptId, password: 'Nova1234' })).status, 401);
  assert.equal((await resetRoute(otherTarget.cookie, { attemptId: otherTarget.attemptId, password: 'Nova123' })).status, 400);
  assert.equal((await resetRoute(otherTarget.cookie, { attemptId: otherTarget.attemptId, password: 'Nova1234' }, null)).status, 403);
  assert.equal((await recoveryCallback(target.state, target.code)).headers.get('location'), '/?auth_error=recovery_failed#login');

  await sql.unsafe('UPDATE finflow_private.google_identities SET verified_email=$2 WHERE subject=$1',
    [profile.sub, 'outro@example.test']);
  assert.equal((await resetRoute(otherTarget.cookie, { attemptId: otherTarget.attemptId, password: 'Nova1234' })).status, 401);
  await sql.unsafe('UPDATE finflow_private.google_identities SET verified_email=$2 WHERE subject=$1', [profile.sub, profile.email]);
  const googleReset = await resetRoute(otherTarget.cookie, { attemptId: otherTarget.attemptId, password: 'Nova1234' });
  assert.equal(googleReset.status, 200);
  assert.equal((await session(googleSession)).status, 401);
  assert.equal((await api('auth/login', { method: 'POST', body: { email: profile.email, password: 'Nova1234' } })).status, 200);
  assert.equal((await session(nativeSession)).status, 200);
  const parallel = await Promise.all([1, 2].map(() => resetRoute(target.cookie, {
    attemptId: target.attemptId, password: 'Outra123',
  })));
  assert.deepEqual(parallel.map(response => response.status).sort(), [200, 401]);
  const reset = parallel.find(response => response.status === 200);
  assert.deepEqual(await reset.json(), { redirect: '/#login' });
  assert.match(reset.headers.getSetCookie()[0], /Max-Age=0/);
  assert.equal((await resetRoute(target.cookie)).status, 401);
  assert.equal((await session(nativeSession)).status, 401);
  assert.equal(await store.rotateSession('stale-credential', oldCredential.id, Date.now() + 5000,
    null, Date.now(), oldCredential.password_salt), false);
  assert.equal((await api('auth/login', { method: 'POST', body: { email: native.email, password: 'senha fict\u00edcia e longa' } })).status, 401);
  assert.equal((await api('auth/login', { method: 'POST', body: { email: native.email, password: 'Outra123' } })).status, 200);

  for (const table of ['sessions', 'google_identities', 'accounts', 'categories', 'recurring_rules', 'transactions',
    'transaction_receipts']) {
    const [row] = await sql.unsafe('SELECT count(*)::int AS count FROM finflow_private.' + table + ' WHERE user_id=$1', [before.id]);
    assert.equal(row.count, 0, table);
  }
});
