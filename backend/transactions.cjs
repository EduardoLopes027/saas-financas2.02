'use strict';

const categories = new Map([
  ['Receita', ['Salário', 'Outras receitas']],
  ['Despesa', ['Moradia', 'Alimentação', 'Transporte', 'Lazer', 'Outras despesas']],
]);

function isCalendarDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) {
    return false;
  }
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function transactionFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { type, category, amount, date, description = '' } = body;
  if (!categories.get(type)?.includes(category) || !isCalendarDate(date)
      || !Number.isSafeInteger(amount) || amount <= 0
      || typeof description !== 'string' || description.length > 80) {
    return null;
  }
  return { type, category, amount, date, description: description.trim() || category };
}

function transactionStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('Receita', 'Despesa')),
      category TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
      date TEXT NOT NULL,
      description TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS transactions_user_date ON transactions(user_id, date DESC, id DESC);
  `);
  const list = db.prepare(`
    SELECT id, type, category, amount, date, description FROM transactions
    WHERE user_id = ? ORDER BY date DESC, id DESC
  `);
  const insert = db.prepare(`
    INSERT INTO transactions (user_id, type, category, amount, date, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return {
    list(userId) {
      return list.all(userId);
    },
    create(userId, fields) {
      const { type, category, amount, date, description } = fields;
      const result = insert.run(userId, type, category, amount, date, description);
      return { id: result.lastInsertRowid, ...fields };
    },
  };
}

module.exports = { transactionFields, transactionStore };
