'use strict';

const categories = new Map([
  ['Receita', ['Salário', 'Outras receitas']],
  ['Despesa', ['Moradia', 'Alimentação', 'Transporte', 'Lazer', 'Outras despesas']],
]);
const paymentMethods = new Set([
  'Pix', 'Cartão de crédito', 'Cartão de débito', 'Débito automático',
  'Boleto bancário', 'Transferência', 'Crédito em conta',
]);
const transactionStatuses = new Set(['Pago', 'Pendente']);

function isCalendarDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) {
    return false;
  }
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function transactionFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { type, category, amount, date, description = '', paymentMethod, status } = body;
  if (!categories.get(type)?.includes(category) || !isCalendarDate(date)
      || !Number.isSafeInteger(amount) || amount <= 0
      || typeof description !== 'string' || description.length > 80
      || (paymentMethod != null && !paymentMethods.has(paymentMethod))
      || (status != null && !transactionStatuses.has(status))) {
    return null;
  }
  const fields = { type, category, amount, date, description: description.trim() || category };
  if (paymentMethod != null) fields.paymentMethod = paymentMethod;
  if (status != null) fields.status = status;
  return fields;
}

function transactionStore(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('Receita', 'Despesa')),
        category TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        payment_method TEXT,
        status TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS transactions_user_date ON transactions(user_id, date DESC, id DESC);
    `);
    const columns = db.prepare('PRAGMA table_info(transactions)').all();
    if (!columns.some(column => column.name === 'payment_method')) {
      db.exec('ALTER TABLE transactions ADD COLUMN payment_method TEXT');
    }
    if (!columns.some(column => column.name === 'status')) {
      db.exec('ALTER TABLE transactions ADD COLUMN status TEXT');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const list = db.prepare(`
    SELECT id, type, category, amount, date, description, payment_method AS paymentMethod, status
    FROM transactions
    WHERE user_id = ? ORDER BY date DESC, id DESC
  `);
  const insert = db.prepare(`
    INSERT INTO transactions (user_id, type, category, amount, date, description, payment_method, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const remove = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?');
  return {
    remove(userId, id) {
      return remove.run(id, userId).changes > 0;
    },
    list(userId) {
      return list.all(userId).map(({ paymentMethod, status, ...item }) => {
        if (paymentMethod !== null) item.paymentMethod = paymentMethod;
        if (status !== null) item.status = status;
        return item;
      });
    },
    create(userId, fields) {
      const { type, category, amount, date, description, paymentMethod = null, status = null } = fields;
      const result = insert.run(userId, type, category, amount, date, description, paymentMethod, status);
      return { id: result.lastInsertRowid, ...fields };
    },
  };
}

module.exports = { transactionFields, transactionStore };
