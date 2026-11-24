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

test('PostgreSQL descartável: esquema, autenticação, edição, anexos e recorrência', {
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
  await db.exec(schema);
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
  server = createServer(createHandler(store, { secure: true, postgres: true, expectedOrigin: origin }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = 'http://127.0.0.1:' + server.address().port;
  const api = (path, { method = 'GET', cookie, body, browserOrigin = origin } = {}) =>
    fetch(root + '/api/index?__route=' + encodeURIComponent(path), {
      method,
      headers: {
        ...(browserOrigin && { Origin: browserOrigin }),
        ...(cookie && { Cookie: cookie }),
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
    });
  async function account(email) {
    const body = { email, password: 'senha fictícia e longa' };
    const register = () => api('auth/register', { method: 'POST', body });
    assert.equal((await register()).status, 201);
    assert.equal((await register()).status, 409);
    const login = await api('auth/login', { method: 'POST', body });
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
  assert.equal((await api('auth/logout', { method: 'POST', cookie: a, body: {} })).status, 204);
  assert.equal((await api('auth/session', { cookie: a })).status, 401);
  assert.equal((await api('auth/session', { cookie: b })).status, 200);
});
