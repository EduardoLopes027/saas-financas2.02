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
  const schema = await readFile(join(__dirname, '../supabase/schema.sql'), 'utf8');
  const migration = await readFile(join(__dirname, '../supabase/migrations/20261126000000_account_settings.sql'), 'utf8');
  const profileStart = schema.indexOf('ALTER TABLE finflow_private.users\n  ADD COLUMN IF NOT EXISTS phone');
  assert.ok(profileStart > 0);
  await db.exec(schema.slice(0, profileStart) + 'COMMIT;');
  await db.exec(migration);
  await db.exec(migration);
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
  const handler = createHandler(store, { secure: true, postgres: true, expectedOrigin: origin, google });
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
  const api = (path, { method = 'GET', cookie, body, browserOrigin = origin, parsed = false, code } = {}) =>
    fetch(root + '/api/index?' + new URLSearchParams({ __route: path, ...(code && { code }) }), {
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

  for (const table of ['sessions', 'google_identities', 'accounts', 'categories', 'recurring_rules', 'transactions',
    'transaction_receipts']) {
    const [row] = await sql.unsafe('SELECT count(*)::int AS count FROM finflow_private.' + table + ' WHERE user_id=$1', [before.id]);
    assert.equal(row.count, 0, table);
  }
});
