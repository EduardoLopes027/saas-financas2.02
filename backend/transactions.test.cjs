'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { start } = require('./auth.cjs');

test('lançamentos persistem e ficam isolados entre duas contas', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'finflow-transactions-'));
  const databasePath = join(directory, 'test.sqlite');
  let app = await start({ port: 0, databasePath });
  const close = () => new Promise(resolve => app.server.close(resolve));
  t.after(async () => {
    if (app.server.listening) await close();
    await rm(directory, { recursive: true });
  });

  const path = '/api/transactions';
  function api(route, { body, cookie, origin } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(app.url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
  async function account(email) {
    const body = { email, password: 'Frase fictícia de teste 456' };
    const registration = await api('/api/auth/register', { body });
    assert.equal(registration.status, 201);
    const { user } = await registration.json();
    const login = await api('/api/auth/login', { body });
    assert.equal(login.status, 200);
    const [header] = login.headers.getSetCookie();
    return { id: user.id, cookie: header.split(';')[0] };
  }
  async function items(cookie) {
    const response = await api(path, { cookie });
    assert.equal(response.status, 200);
    return (await response.json()).items;
  }
  async function add(cookie, body) {
    const response = await api(path, { cookie, body, origin: app.url });
    assert.equal(response.status, 201);
    return (await response.json()).item;
  }

  const income = { type: 'Receita', category: 'Salário', amount: 250000, date: '2026-11-05' };
  const expense = { type: 'Despesa', category: 'Alimentação', amount: 3990, date: '2026-11-10', description: ' Mercado ' };
  assert.equal((await api(path)).status, 401);
  assert.equal((await api(path, { body: income })).status, 401);
  const a = await account('conta-a@example.test');
  const b = await account('conta-b@example.test');
  assert.deepEqual(await items(a.cookie), []);
  assert.deepEqual(await items(b.cookie), []);

  for (const body of [{ ...income, amount: 1.5 }, { ...income, date: '2026-02-30' }, { ...income, category: 'Moradia' }]) {
    const invalid = await api(path, { cookie: a.cookie, body });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'invalid_transaction' });
  }
  assert.equal((await api(path, { cookie: a.cookie, body: income, origin: 'https://example.test' })).status, 403);

  const first = await add(a.cookie, { ...income, user_id: b.id });
  assert.deepEqual(first, { id: first.id, ...income, description: 'Salário' });
  assert.deepEqual(await items(b.cookie), []);
  const second = await add(a.cookie, expense);
  const third = await add(b.cookie, { ...income, amount: 10000 });
  assert.equal(second.description, 'Mercado');
  assert.deepEqual(await items(a.cookie), [second, first]);
  assert.deepEqual(await items(b.cookie), [third]);

  await close();
  app = await start({ port: 0, databasePath });
  assert.deepEqual(await items(a.cookie), [second, first]);
  assert.deepEqual(await items(b.cookie), [third]);

  const logout = await api('/api/auth/logout', { body: {}, cookie: a.cookie });
  assert.equal(logout.status, 204);
  assert.equal((await api(path, { cookie: a.cookie })).status, 401);
  assert.equal((await api(path, { cookie: a.cookie, body: expense })).status, 401);
  assert.deepEqual(await items(b.cookie), [third]);
});
