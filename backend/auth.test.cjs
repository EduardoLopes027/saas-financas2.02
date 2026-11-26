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
  const loginProfile = (await loggedIn.json()).user;
  const [setCookie, legacyCookie] = loggedIn.headers.getSetCookie();
  assert.match(setCookie, /; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=604800$/);
  assert.match(legacyCookie, /; Path=\/api\/auth; .*Max-Age=0$/);
  const cookie = setCookie.split(';')[0];
  const currentSession = async () => (await (await api('session', { headers: { cookie } })).json()).user;
  const initialProfile = await currentSession();
  assert.deepEqual(initialProfile, loginProfile);
  assert.equal(initialProfile.id, account.user.id);
  assert.equal(initialProfile.email, account.user.email);
  assert.ok(Date.parse(initialProfile.createdAt));
  assert.equal(initialProfile.emailVerified, false);
  assert.equal(initialProfile.createdAt, initialProfile.updatedAt);

  await close(app.server);
  app = await start({ port: 0, databasePath });
  assert.deepEqual(await currentSession(), initialProfile);

  const rotated = await api('login', { body: credentials, headers: { cookie } });
  assert.equal(rotated.status, 200);
  const newCookie = rotated.headers.get('set-cookie').split(';')[0];
  assert.notEqual(newCookie, cookie);
  assert.equal((await api('session', { headers: { cookie } })).status, 401);

  const loggedOut = await api('logout', { body: { expectedUserId: initialProfile.id }, headers: { cookie: newCookie } });
  assert.equal(loggedOut.status, 204);
  assert.deepEqual(loggedOut.headers.getSetCookie(), []);
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
    const { user } = await session.json();
    assert.equal(user.name, profile.name);
    assert.equal(user.displayName, profile.name);
    assert.equal(user.salaryDay, profile.salaryDay);
    assert.equal(user.paydayRule, 'fixed');
    assert.equal(user.paydayDay, 15);
  }
});

test('account settings persist and deletion purges only the authenticated owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'finflow-settings-'));
  const databasePath = join(directory, 'test.sqlite');
  const { DatabaseSync } = require('node:sqlite');
  const { server, url } = await start({ port: 0, databasePath });
  t.after(async () => {
    await close(server);
    await rm(directory, { recursive: true });
  });

  function api(path, method, body, cookie, origin = url) {
    return fetch(url + '/api/' + path, {
      method, headers: {
        Origin: origin, ...(cookie && { Cookie: cookie }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function account(email) {
    const body = { ...credentials, email };
    const registered = await api('auth/register', 'POST', body);
    assert.equal(registered.status, 201);
    const { user } = await registered.json();
    return { id: user.id, login: async () => {
      const loggedIn = await api('auth/login', 'POST', body);
      assert.equal(loggedIn.status, 200);
      return loggedIn.headers.getSetCookie()[0].split(';')[0];
    } };
  }

  const a = await account('a@example.test');
  const b = await account('b@example.test');
  const first = await a.login();
  const second = await a.login();
  const other = await b.login();
  const patch = (body, cookie = first, origin) => api('auth/profile', 'PATCH', {
    expectedUserId: a.id, ...body,
  }, cookie, origin);
  assert.equal((await api('auth/profile', 'PATCH', { theme: 'dark' }, first)).status, 400);
  assert.equal((await patch({ theme: 'dark' }, other)).status, 409);
  assert.equal((await patch({ theme: 'dark' }, '', url)).status, 401);
  assert.equal((await patch({ theme: 'dark' }, first, 'https://foreign.example.test')).status, 403);
  for (const body of [{}, { emailVerified: true }, { id: b.id }, { paydayDay: 32 }, { currency: 'USD' }, { amountMask: 'false' }]) {
    assert.equal((await patch(body)).status, 400);
  }
  const preferences = {
    displayName: 'Pessoa A', phone: '+55 11 5555-0101', paydayRule: 'fixed', paydayDay: 31,
    theme: 'dark', carryOver: false, amountMask: false, currency: 'BRL',
  };
  const updated = await patch(preferences);
  assert.equal(updated.status, 200);
  const { user } = await updated.json();
  for (const [key, value] of Object.entries(preferences)) assert.equal(user[key], value);
  assert.ok(Date.parse(user.updatedAt) >= Date.parse(user.createdAt));
  const session = async cookie => (await (await api('auth/session', 'GET', undefined, cookie)).json()).user;
  assert.deepEqual(await session(second), user);
  assert.equal((await session(other)).theme, 'light');
  const staleLogout = await api('auth/logout', 'POST', { expectedUserId: a.id }, other);
  assert.equal(staleLogout.status, 409);
  assert.deepEqual(await staleLogout.json(), { error: 'account_changed' });
  assert.deepEqual(staleLogout.headers.getSetCookie(), []);
  assert.equal((await api('auth/logout', 'POST', {}, other)).status, 400);
  assert.equal((await session(other)).id, b.id);

  const payment = {
    type: 'Despesa', category: 'Moradia', amount: 500, date: '2096-01-31', recurrence: 'Mensal',
    receipt: { name: 'test.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64') },
  };
  assert.equal((await api('transactions', 'POST', payment, first)).status, 201);
  assert.equal((await api('transactions', 'POST', payment, other)).status, 201);
  const purge = (confirm, cookie = first, origin) => api('user/account', 'DELETE', {
    confirm, expectedUserId: a.id,
  }, cookie, origin);
  assert.equal((await api('user/account', 'DELETE', { confirm: true }, first)).status, 400);
  assert.equal((await purge(true, other)).status, 409);
  assert.equal((await purge(true, '')).status, 401);
  assert.equal((await purge(true, first, 'https://foreign.example.test')).status, 403);
  assert.equal((await purge(false)).status, 400);
  assert.equal((await session(second)).id, a.id);
  const removed = await purge(true);
  assert.equal(removed.status, 204);
  assert.ok(removed.headers.getSetCookie().every(cookie => cookie.includes('Max-Age=0')));
  assert.equal((await api('auth/session', 'GET', undefined, first)).status, 401);
  assert.equal((await api('auth/session', 'GET', undefined, second)).status, 401);
  assert.equal((await purge(true)).status, 401);
  assert.equal((await session(other)).id, b.id);

  const db = new DatabaseSync(databasePath);
  try {
    for (const table of ['transactions', 'transaction_receipts', 'transaction_recurrences']) {
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count, 1, table);
    }
    assert.deepEqual(db.prepare('SELECT id FROM users ORDER BY id').all().map(row => row.id), [b.id]);
  } finally {
    db.close();
  }
  assert.notEqual((await account('a@example.test')).id, a.id);
});
