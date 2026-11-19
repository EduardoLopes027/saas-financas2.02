'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { start } = require('./auth.cjs');

const credentials = { email: ' pessoa@example.test ', password: 'Frase fictícia de teste 123' };

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('cadastro, unicidade, login, sessão persistente, logout e proteção local', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'finflow-auth-'));
  const databasePath = join(directory, 'test.sqlite');
  let app;
  t.after(async () => {
    if (app?.server.listening) await close(app.server);
    await rm(directory, { recursive: true });
  });
  app = await start({ port: 0, databasePath });

  function api(path, { body, headers = {} } = {}) {
    return fetch(app.url + '/api/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  assert.equal((await fetch(app.url + '/')).status, 200);
  assert.equal((await api('session')).status, 401);
  assert.equal((await api('register', { body: credentials, headers: { Origin: 'https://example.test' } })).status, 403);
  assert.equal((await api('register', { body: { ...credentials, password: 'curta' } })).status, 400);

  const created = await api('register', { body: credentials, headers: { Origin: app.url } });
  assert.equal(created.status, 201);
  const account = await created.json();
  assert.deepEqual(account, { user: { id: 1, email: 'pessoa@example.test' } });
  assert.equal((await api('register', { body: { ...credentials, email: 'PESSOA@example.test' } })).status, 409);

  const invalid = await api('login', { body: { ...credentials, password: 'incorreta' } });
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: 'invalid_credentials' });
  const unknown = await api('login', { body: { ...credentials, email: 'outro@example.test' } });
  assert.equal(unknown.status, 401);
  assert.deepEqual(await unknown.json(), { error: 'invalid_credentials' });

  const loggedIn = await api('login', { body: credentials });
  assert.equal(loggedIn.status, 200);
  assert.deepEqual(await loggedIn.json(), account);
  const [setCookie, legacyCookie] = loggedIn.headers.getSetCookie();
  assert.match(setCookie, /; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=604800$/);
  assert.match(legacyCookie, /; Path=\/api\/auth; .*Max-Age=0$/);
  const cookie = setCookie.split(';')[0];
  assert.deepEqual(await (await api('session', { headers: { cookie } })).json(), account);

  await close(app.server);
  app = await start({ port: 0, databasePath });
  assert.deepEqual(await (await api('session', { headers: { cookie } })).json(), account);

  const rotated = await api('login', { body: credentials, headers: { cookie } });
  assert.equal(rotated.status, 200);
  const newCookie = rotated.headers.get('set-cookie').split(';')[0];
  assert.notEqual(newCookie, cookie);
  assert.equal((await api('session', { headers: { cookie } })).status, 401);

  const loggedOut = await api('logout', { body: {}, headers: { cookie: newCookie } });
  assert.equal(loggedOut.status, 204);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0$/);
  assert.equal((await api('session', { headers: { cookie: newCookie } })).status, 401);
});

test('limita tentativas simultâneas e persiste o orçamento entre reinicializações', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'finflow-rate-'));
  const databasePath = join(directory, 'rate.sqlite');
  let app;
  t.after(async () => {
    if (app?.server.listening) await close(app.server);
    await rm(directory, { recursive: true });
  });
  app = await start({ port: 0, databasePath });
  const invalidLogin = () => fetch(app.url + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  // Keep the fixed window stable even when the test runs at a real boundary.
  t.mock.method(Date, 'now', () => 1800000000000);
  const concurrent = await Promise.all(Array.from({ length: 5 }, invalidLogin));
  assert.deepEqual(concurrent.map(response => response.status).sort(), [401, 401, 401, 401, 429]);
  for (let index = 0; index < 8; index++) assert.equal((await invalidLogin()).status, 401);
  await close(app.server);
  app = await start({ port: 0, databasePath });
  const blocked = await invalidLogin();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('salva o perfil do cadastro e respeita a duração escolhida no login', async t => {
  const { server, url } = await start({ port: 0, databasePath: ':memory:' });
  t.after(() => close(server));
  const post = (route, fields) => fetch(url + '/api/auth/' + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...credentials, ...fields }),
  });
  assert.equal((await post('register', { salaryDay: '45' })).status, 400);
  const profile = { name: 'Pessoa Teste', salaryDay: '15' };
  const registered = await post('register', profile);
  assert.equal(registered.status, 201);
  for (const remember of [true, false]) {
    const login = await post('login', { remember });
    assert.equal(login.status, 200);
    const [cookie] = login.headers.getSetCookie();
    if (remember) assert.match(cookie, /Max-Age=2592000$/);
    else assert.doesNotMatch(cookie, /Max-Age|Expires/i);
    const session = await fetch(url + '/api/auth/session', {
      headers: { Cookie: cookie.split(';')[0] },
    });
    assert.deepEqual((await session.json()).user, { id: 1, email: 'pessoa@example.test', ...profile });
  }
});
