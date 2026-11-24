'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { request } = require('node:http');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { start } = require('./auth.cjs');
const { transactionFields, transactionStore, MAX_TRANSACTION_BODY } = require('./transactions.cjs');

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

  const invalidTransactions = [
    { ...income, amount: 1.5 },
    { ...income, date: '2026-02-30' },
    { ...income, category: 'Moradia' },
    { ...income, paymentMethod: 'Inválido' },
    { ...income, status: 'Inválido' },
  ];
  for (const body of invalidTransactions) {
    const invalid = await api(path, { cookie: a.cookie, body });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'invalid_transaction' });
  }
  assert.equal((await api(path, { cookie: a.cookie, body: income, origin: 'https://example.test' })).status, 403);

  const first = await add(a.cookie, { ...income, user_id: b.id });
  assert.deepEqual(first, { id: first.id, ...income, description: 'Salário' });
  assert.deepEqual(await items(b.cookie), []);
  const payment = { paymentMethod: 'Cartão de crédito', status: 'Pendente' };
  const second = await add(a.cookie, { ...expense, ...payment });
  const third = await add(b.cookie, { ...income, amount: 10000, paymentMethod: null, status: null });
  assert.deepEqual(second, { id: second.id, ...expense, ...payment, description: 'Mercado' });
  assert.deepEqual(third, { id: third.id, ...income, amount: 10000, description: 'Salário' });
  assert.deepEqual(await items(a.cookie), [second, first]);
  assert.deepEqual(await items(b.cookie), [third]);

  const pdf = Buffer.alloc(5 * 1024 * 1024, 32);
  pdf.write('%PDF-1.4\n');
  pdf.write('%%EOF\n', pdf.length - 6);
  const receipt = { name: 'Recibo fictício.pdf', mimeType: 'application/pdf', dataBase64: pdf.toString('base64') };
  const transfer = {
    type: 'Transferência', category: 'Transferência', amount: 100, date: expense.date,
    paymentMethod: 'Pix', destinationPaymentMethod: 'Crédito em conta', notes: 'Interna #reserva',
  };
  for (const body of [
    { ...transfer, destinationPaymentMethod: 'Pix' },
    { ...expense, installments: 49 },
    { ...expense, amount: 2, installments: 3 },
    { ...expense, installments: 2, recurrence: 'Mensal' },
    { ...expense, receipt: { ...receipt, mimeType: 'image/png' } },
    { ...expense, receipt: { ...receipt, dataBase64: Buffer.concat([pdf, Buffer.from(' ')]).toString('base64') } },
  ]) {
    assert.equal((await api(path, { body, cookie: a.cookie })).status, 400);
  }
  const oversized = await api(path, { body: { notes: 'x'.repeat(MAX_TRANSACTION_BODY) }, cookie: a.cookie });
  assert.equal(oversized.status, 413);
  const fourth = await add(a.cookie, { ...transfer, receipt });
  const summary = { name: receipt.name, mimeType: receipt.mimeType, size: pdf.length };
  assert.deepEqual(fourth, { id: fourth.id, description: transfer.category, ...transfer, receipt: summary });
  assert.deepEqual(await items(a.cookie), [fourth, second, first]);
  assert.deepEqual(await items(b.cookie), [third]);

  await close();
  app = await start({ port: 0, databasePath });
  assert.deepEqual(await items(a.cookie), [fourth, second, first]);
  assert.deepEqual(await items(b.cookie), [third]);
  const download = path + '/' + fourth.id + '/receipt';
  assert.equal((await api(download)).status, 401);
  assert.equal((await api(download, { cookie: b.cookie })).status, 404);
  const file = await api(download, { cookie: a.cookie });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), receipt.mimeType);
  assert.match(file.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  const deleted = await fetch(app.url + path + '/' + fourth.id, {
    method: 'DELETE', headers: { Cookie: a.cookie },
  });
  assert.equal(deleted.status, 204);
  assert.equal((await api(download, { cookie: a.cookie })).status, 404);

  const logout = await api('/api/auth/logout', { body: {}, cookie: a.cookie });
  assert.equal(logout.status, 204);
  assert.equal((await api(path, { cookie: a.cookie })).status, 401);
  assert.equal((await api(path, { cookie: a.cookie, body: expense })).status, 401);
  assert.deepEqual(await items(b.cookie), [third]);
});

test('parcelas são exatas, ancoradas na data original e gravadas juntas', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT; INSERT INTO users VALUES (1)');
  const store = transactionStore(db);
  const fields = transactionFields({
    type: 'Despesa', category: 'Moradia', amount: Number.MAX_SAFE_INTEGER,
    date: '2028-01-31', installments: 3, status: 'Pendente',
  });
  db.exec(`
    CREATE TRIGGER reject_second BEFORE INSERT ON transactions WHEN NEW.installment_number = 2
    BEGIN SELECT RAISE(ABORT, 'falha de teste'); END;
  `);
  assert.throws(() => store.create(1, fields), /falha de teste/);
  assert.deepEqual(store.list(1), []);
  db.exec('DROP TRIGGER reject_second');
  const first = store.create(1, fields);
  const items = store.list(1).reverse();
  assert.deepEqual(items[0], first);
  assert.deepEqual(items.map(item => item.date), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.deepEqual(items.map(item => item.installmentNumber), [1, 2, 3]);
  assert.deepEqual(items.map(item => item.status), ['Pendente', 'Pendente', 'Pendente']);
  assert.deepEqual(items.map(item => item.amount), [3002399751580331, 3002399751580330, 3002399751580330]);
  assert.equal(items.reduce((total, item) => total + BigInt(item.amount), 0n), BigInt(fields.amount));
});

test('recorrências persistem, preservam a âncora e não recriam ocorrências excluídas', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'finflow-recurrences-'));
  const databasePath = join(directory, 'test.sqlite');
  let db = new DatabaseSync(databasePath);
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true });
  });
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT; INSERT INTO users VALUES (1), (2)');
  let store = transactionStore(db);
  const base = { type: 'Despesa', category: 'Moradia', amount: 100, status: 'Pago' };
  store.create(1, transactionFields({ ...base, date: '2024-02-29', recurrence: 'Anual' }));
  store.create(1, transactionFields({ ...base, date: '2028-01-31', recurrence: 'Mensal' }));
  store.create(1, transactionFields({ ...base, date: '2028-01-30', recurrence: 'Semanal' }));
  assert.deepEqual(store.list(2, '2028-04-29'), []);
  assert.equal(db.prepare('SELECT count(*) AS count FROM transactions').get().count, 3);
  const items = store.list(1, '2028-02-29');
  const dates = (rows, recurrence) => rows.filter(item => item.recurrence === recurrence).map(item => item.date);
  assert.deepEqual(dates(items, 'Anual'), ['2028-02-29', '2027-02-28', '2026-02-28', '2025-02-28', '2024-02-29']);
  assert.deepEqual(dates(items, 'Mensal'), ['2028-02-29', '2028-01-31']);
  assert.deepEqual(dates(items, 'Semanal'), ['2028-02-27', '2028-02-20', '2028-02-13', '2028-02-06', '2028-01-30']);
  assert.ok(items.every(item => item.status === 'Pago'));
  const deleted = items.find(item => item.recurrence === 'Mensal' && item.date === '2028-02-29');
  assert.equal(store.remove(2, deleted.id), false);
  assert.equal(store.remove(1, deleted.id), true);

  db.close();
  db = new DatabaseSync(databasePath);
  store = transactionStore(db);
  assert.deepEqual(store.list(1, '2028-02-29'), items.filter(item => item.id !== deleted.id));
  const next = store.list(1, '2028-03-31');
  assert.deepEqual(dates(next, 'Mensal'), ['2028-03-31', '2028-01-31']);
  assert.deepEqual(store.list(1, '2028-03-31'), next);
});

test('a migração mantém lançamentos antigos e aceita os campos opcionais', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;
    INSERT INTO users VALUES (1);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('Receita', 'Despesa')),
      category TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
      date TEXT NOT NULL,
      description TEXT NOT NULL
    ) STRICT;
    INSERT INTO transactions VALUES (1, 1, 'Despesa', 'Moradia', 10000, '2026-11-01', 'Aluguel');
  `);

  const legacy = { id: 1, type: 'Despesa', category: 'Moradia', amount: 10000, date: '2026-11-01', description: 'Aluguel' };
  const store = transactionStore(db);
  assert.deepEqual(store.list(1), [legacy]);
  const saved = store.create(1, {
    type: 'Receita', category: 'Salário', amount: 50000, date: '2026-11-02',
    description: 'Salário', paymentMethod: 'Pix', status: 'Pago',
  });
  assert.deepEqual(transactionStore(db).list(1), [saved, legacy]);
});

test('DELETE valida sessão, origem e ID, remove com 204 e isola as contas', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'finflow-delete-'));
  const databasePath = join(directory, 'test.sqlite');
  let app = await start({ port: 0, databasePath });
  const close = () => new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
  t.after(async () => {
    if (app.server.listening) await close();
    await rm(directory, { recursive: true });
  });

  function api(route, { method = 'GET', cookie, origin, body } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (origin !== undefined) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(app.url + route, { method, headers, body: JSON.stringify(body) });
  }
  async function account(email) {
    const body = { email, password: 'Frase fictícia de teste 789' };
    assert.equal((await api('/api/auth/register', { method: 'POST', body })).status, 201);
    const login = await api('/api/auth/login', { method: 'POST', body });
    assert.equal(login.status, 200);
    return login.headers.getSetCookie()[0].split(';')[0];
  }
  const path = '/api/transactions';
  const a = await account('delete-a@example.test');
  const b = await account('delete-b@example.test');
  const fields = { type: 'Despesa', category: 'Moradia', amount: 10000, date: '2026-11-18' };
  async function add(cookie) {
    const response = await api(path, { method: 'POST', cookie, body: fields });
    assert.equal(response.status, 201);
    return (await response.json()).item;
  }
  async function items(cookie) {
    const response = await api(path, { cookie });
    assert.equal(response.status, 200);
    return (await response.json()).items;
  }
  async function error(response, status, code) {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
  const first = await add(a);
  const second = await add(a);
  const other = await add(b);
  const remove = (id, options = {}) => api(path + '/' + id, { method: 'DELETE', ...options });

  await error(await remove(first.id), 401, 'unauthenticated');
  await error(await remove(first.id, { cookie: 'finflow_session=invalid' }), 401, 'unauthenticated');
  await error(await remove('invalid'), 401, 'unauthenticated');
  for (const id of ['', '0', '-1', '1.5', '1e0', '01', '+1', 'NaN', 'Infinity', '9007199254740992', '1/extra', '%31']) {
    await error(await remove(id, { cookie: a }), 400, 'invalid_transaction');
  }
  await error(await remove(first.id, { cookie: a, origin: 'https://example.test' }), 403, 'origin_not_allowed');
  await error(await remove(first.id, { cookie: a, origin: 'null' }), 403, 'origin_not_allowed');
  const untrustedHost = await new Promise((resolve, reject) => {
    const req = request(app.url + path + '/' + first.id, {
      method: 'DELETE', headers: { Host: 'example.test', Cookie: a },
    }, async response => {
      try {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) });
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
    req.end();
  });
  assert.deepEqual(untrustedHost, { status: 403, body: { error: 'host_not_allowed' } });
  await error(await remove(other.id, { cookie: a }), 404, 'not_found');
  await error(await remove(Number.MAX_SAFE_INTEGER, { cookie: a }), 404, 'not_found');
  assert.deepEqual(await items(a), [second, first]);
  assert.deepEqual(await items(b), [other]);

  // DELETE sem corpo ou Content-Type, com a origem local.
  const deleted = await remove(first.id, { cookie: a, origin: app.url });
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.equal(deleted.headers.get('content-type'), null);
  assert.equal(deleted.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await items(a), [second]);
  assert.deepEqual(await items(b), [other]);
  await error(await remove(first.id, { cookie: a }), 404, 'not_found');

  await close();
  app = await start({ port: 0, databasePath });
  assert.deepEqual(await items(a), [second]);
  assert.deepEqual(await items(b), [other]);

  // A política atual também permite clientes sem o cabeçalho Origin.
  const withoutOrigin = await remove(second.id, { cookie: a });
  assert.equal(withoutOrigin.status, 204);
  assert.equal(await withoutOrigin.text(), '');
  const logout = await api('/api/auth/logout', { method: 'POST', cookie: b, body: {} });
  assert.equal(logout.status, 204);
  await error(await remove(other.id, { cookie: b }), 401, 'unauthenticated');
  assert.deepEqual(await items(a), []);
});
