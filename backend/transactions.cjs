'use strict';

const categories = new Map([
  ['Receita', ['Salário', 'Outras receitas']],
  ['Despesa', ['Moradia', 'Alimentação', 'Transporte', 'Lazer', 'Outras despesas']],
  ['Transferência', ['Transferência']],
]);
const paymentMethods = new Set([
  'Pix', 'Cartão de crédito', 'Cartão de débito', 'Débito automático',
  'Boleto bancário', 'Transferência', 'Crédito em conta',
]);
const transactionStatuses = new Set(['Pago', 'Pendente']);
const recurrences = new Set(['Semanal', 'Mensal', 'Anual']);
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BASE64 = 4 * Math.ceil(MAX_RECEIPT_BYTES / 3);
const MAX_TRANSACTION_BODY = MAX_RECEIPT_BASE64 + 32 * 1024;

function receiptFields(receipt) {
  const { name, mimeType, dataBase64 } = receipt ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || !name.isWellFormed()
      || /[\x00-\x1f\x7f/\\]/.test(name)
      || typeof dataBase64 !== 'string' || dataBase64.length > MAX_RECEIPT_BASE64) return null;
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length > MAX_RECEIPT_BYTES || bytes.toString('base64') !== dataBase64) return null;
  const hex = (start, end) => bytes.subarray(start, end).toString('hex');
  const valid = {
    'application/pdf': () => /^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString('latin1'))
      && /%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1')),
    'image/png': () => hex(0, 16) === '89504e470d0a1a0a0000000d49484452'
      && hex(-12) === '0000000049454e44ae426082',
    'image/jpeg': () => hex(0, 3) === 'ffd8ff' && hex(-2) === 'ffd9',
  };
  if (typeof mimeType !== 'string' || !Object.hasOwn(valid, mimeType) || !valid[mimeType]()) return null;
  return { name: name.trim(), mimeType, bytes };
}

function isCalendarDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) {
    return false;
  }
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function transactionFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const {
    type, category, amount, date, description = '', paymentMethod, status,
    destinationPaymentMethod, notes, recurrence, installments = 1, receipt,
  } = body;
  if (!categories.get(type)?.includes(category) || !isCalendarDate(date)
      || !Number.isSafeInteger(amount) || amount <= 0
      || typeof description !== 'string' || description.length > 80
      || (paymentMethod != null && !paymentMethods.has(paymentMethod))
      || (status != null && !transactionStatuses.has(status))
      || (type === 'Transferência'
        ? !paymentMethods.has(paymentMethod) || !paymentMethods.has(destinationPaymentMethod)
          || paymentMethod === destinationPaymentMethod
        : destinationPaymentMethod != null)
      || (notes != null && (typeof notes !== 'string' || notes.length > 2000))
      || (recurrence != null && !recurrences.has(recurrence))
      || !Number.isInteger(installments) || installments < 1 || installments > 48
      || amount < installments || (recurrence != null && installments > 1)
      || (installments > 1 && !occurrenceDate(date, 'Mensal', installments - 1))) {
    return null;
  }
  const fields = { type, category, amount, date, description: description.trim() || category };
  if (paymentMethod != null) fields.paymentMethod = paymentMethod;
  if (status != null) fields.status = status;
  if (destinationPaymentMethod != null) fields.destinationPaymentMethod = destinationPaymentMethod;
  if (notes != null) fields.notes = notes;
  if (recurrence != null) fields.recurrence = recurrence;
  if (installments > 1) fields.installments = installments;
  if (receipt != null) {
    fields.receipt = receiptFields(receipt);
    if (!fields.receipt) return null;
  }
  return fields;
}

function occurrenceDate(anchor, frequency, index) {
  const date = new Date(anchor);
  if (frequency === 'Semanal') {
    date.setUTCDate(date.getUTCDate() + 7 * index);
  } else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + index * (frequency === 'Anual' ? 12 : 1));
    const monthEnd = new Date(date);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
  }
  return date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : null;
}

function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
}

function transactionStore(db) {
  function atomic(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function createTable() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('Receita', 'Despesa', 'Transferência')),
        category TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        payment_method TEXT,
        status TEXT,
        destination_payment_method TEXT,
        notes TEXT,
        recurrence TEXT,
        installments INTEGER,
        installment_number INTEGER
      ) STRICT;
    `);
  }
  atomic(() => {
    createTable();
    const columns = db.prepare('PRAGMA table_info(transactions)').all();
    const has = name => columns.some(column => column.name === name);
    if (!has('destination_payment_method')) {
      db.exec('ALTER TABLE transactions RENAME TO legacy_transactions');
      createTable();
      db.exec(`
        INSERT INTO transactions (id, user_id, type, category, amount, date, description, payment_method, status)
        SELECT id, user_id, type, category, amount, date, description,
          ${has('payment_method') ? 'payment_method' : 'NULL'}, ${has('status') ? 'status' : 'NULL'}
        FROM legacy_transactions;
        DROP TABLE legacy_transactions;
      `);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS transactions_user_date ON transactions(user_id, date DESC, id DESC);
      CREATE TABLE IF NOT EXISTS transaction_receipts (
        transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
        name TEXT NOT NULL, mime_type TEXT NOT NULL, bytes BLOB NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS transaction_recurrences (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fields TEXT NOT NULL,
        next_index INTEGER NOT NULL,
        next_date TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS transaction_recurrences_due ON transaction_recurrences(user_id, next_date);
    `);
  });
  const list = db.prepare(`
    SELECT t.id, type, category, amount, date, description, payment_method AS paymentMethod, status,
      destination_payment_method AS destinationPaymentMethod, notes, recurrence,
      installments, installment_number AS installmentNumber,
      r.name AS receiptName, r.mime_type AS receiptMimeType, length(r.bytes) AS receiptSize
    FROM transactions t LEFT JOIN transaction_receipts r ON r.transaction_id = t.id
    WHERE t.user_id = ? ORDER BY date DESC, t.id DESC
  `);
  const insert = db.prepare(`
    INSERT INTO transactions (user_id, type, category, amount, date, description, payment_method, status,
      destination_payment_method, notes, recurrence, installments, installment_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const remove = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?');
  const saveReceipt = db.prepare('INSERT INTO transaction_receipts VALUES (?, ?, ?, ?)');
  const findReceipt = db.prepare(`
    SELECT r.name, r.mime_type AS mimeType, r.bytes
    FROM transaction_receipts r JOIN transactions t ON t.id = r.transaction_id
    WHERE t.user_id = ? AND t.id = ?
  `);
  const saveRule = db.prepare(`
    INSERT INTO transaction_recurrences (user_id, fields, next_index, next_date) VALUES (?, ?, 1, ?)
  `);
  const dueRules = db.prepare(`
    SELECT id, fields, next_index, next_date FROM transaction_recurrences
    WHERE user_id = ? AND next_date <= ?
  `);
  const advanceRule = db.prepare('UPDATE transaction_recurrences SET next_index = ?, next_date = ? WHERE id = ?');

  function insertItem(userId, fields) {
    const { type, category, amount, date, description, paymentMethod = null, status = null,
      destinationPaymentMethod = null, notes = null, recurrence = null, installments = null,
      installmentNumber = null } = fields;
    const { lastInsertRowid: id } = insert.run(userId, type, category, amount, date, description,
      paymentMethod, status, destinationPaymentMethod, notes, recurrence, installments, installmentNumber);
    return { id, ...fields };
  }

  return {
    remove(userId, id) {
      return remove.run(id, userId).changes > 0;
    },
    receipt(userId, id) {
      return findReceipt.get(userId, id);
    },
    list(userId, today = localDate()) {
      if (dueRules.get(userId, today)) atomic(() => {
        for (const rule of dueRules.all(userId, today)) {
          const fields = JSON.parse(rule.fields);
          let index = rule.next_index;
          let date = rule.next_date;
          while (date && date <= today) {
            insertItem(userId, { ...fields, date });
            date = occurrenceDate(fields.date, fields.recurrence, ++index);
          }
          advanceRule.run(index, date, rule.id);
        }
      });
      return list.all(userId).map(({ receiptName, receiptMimeType, receiptSize, ...row }) => {
        const item = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
        if (receiptName !== null) item.receipt = { name: receiptName, mimeType: receiptMimeType, size: receiptSize };
        return item;
      });
    },
    create(userId, { receipt, ...fields }) {
      return atomic(() => {
        let item;
        if (fields.installments > 1) {
          const total = BigInt(fields.amount);
          const count = BigInt(fields.installments);
          const base = total / count;
          const remainder = Number(total % count);
          for (let index = 0; index < fields.installments; index++) {
            const installment = insertItem(userId, {
              ...fields,
              amount: Number(base) + Number(index < remainder),
              date: occurrenceDate(fields.date, 'Mensal', index),
              installmentNumber: index + 1,
            });
            item ??= installment;
          }
        } else {
          item = insertItem(userId, fields);
        }
        if (fields.recurrence) {
          saveRule.run(userId, JSON.stringify(fields), occurrenceDate(fields.date, fields.recurrence, 1));
        }
        if (receipt) {
          const { name, mimeType, bytes } = receipt;
          saveReceipt.run(item.id, name, mimeType, bytes);
          item.receipt = { name, mimeType, size: bytes.length };
        }
        return item;
      });
    },
  };
}

module.exports = { transactionFields, transactionStore, MAX_TRANSACTION_BODY };
