'use strict';

const { X509Certificate } = require('node:crypto');
const { occurrenceDate, localDate, transactionRows, updateFields } = require('./transactions.cjs');

const schema = 'finflow_private';
const columns = `t.id, t.type, t.category, (t.amount * 100)::bigint AS amount, t.date::text AS date,
  t.description, t.payment_method AS "paymentMethod", t.status,
  t.destination_payment_method AS "destinationPaymentMethod", t.notes, t.recurrence,
  t.installments, t.installment_number AS "installmentNumber"`;
const receiptColumns = `r.name AS "receiptName", r.mime_type AS "receiptMimeType",
  octet_length(r.bytes) AS "receiptSize"`;
const joinReceipt = `LEFT JOIN ${schema}.transaction_receipts r
  ON r.user_id = t.user_id AND r.transaction_id = t.id`;

function itemFromRow({ receiptName, receiptMimeType, receiptSize, ...row }) {
  const item = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
  item.amount = Number(item.amount);
  if (receiptName != null) item.receipt = { name: receiptName, mimeType: receiptMimeType, size: receiptSize };
  return item;
}

function decimal(cents) {
  const digits = String(cents).padStart(3, '0');
  return digits.slice(0, -2) + '.' + digits.slice(-2);
}

function mutableValues(fields) {
  return [fields.type, fields.category, decimal(fields.amount), fields.date, fields.description,
    fields.paymentMethod ?? null, fields.status ?? null, fields.destinationPaymentMethod ?? null, fields.notes ?? null];
}

async function ensureReferences(query, userId, fields) {
  await query.unsafe(`INSERT INTO ${schema}.categories (user_id, type, name)
    VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [userId, fields.type, fields.category]);
  const methods = [fields.paymentMethod, fields.destinationPaymentMethod].filter(Boolean).sort();
  for (const method of methods) {
    await query.unsafe(`INSERT INTO ${schema}.accounts (user_id, name)
      VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, method]);
  }
}

async function insertItem(query, userId, fields) {
  const [row] = await query.unsafe(`INSERT INTO ${schema}.transactions AS t
    (user_id, type, category, amount, date, description, payment_method, status,
      destination_payment_method, notes, recurrence, installments, installment_number)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${columns}`,
  [userId, ...mutableValues(fields), fields.recurrence ?? null, fields.installments ?? null,
    fields.installmentNumber ?? null]);
  return itemFromRow(row);
}

async function saveReceipt(query, userId, item, receipt) {
  if (receipt === undefined) return;
  if (receipt === null) {
    await query.unsafe(`DELETE FROM ${schema}.transaction_receipts WHERE user_id = $1 AND transaction_id = $2`,
      [userId, item.id]);
    delete item.receipt;
    return;
  }
  const { name, mimeType, bytes } = receipt;
  await query.unsafe(`INSERT INTO ${schema}.transaction_receipts (user_id, transaction_id, name, mime_type, bytes)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, transaction_id) DO UPDATE
    SET name = excluded.name, mime_type = excluded.mime_type, bytes = excluded.bytes`,
  [userId, item.id, name, mimeType, bytes]);
  item.receipt = { name, mimeType, size: bytes.length };
}

function configurationError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeCa(value) {
  const pem = value?.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/\\r\\n|\\[rn]/g, '\n').trim();
  if (!pem) return undefined;
  const pattern = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
  const certificates = [];
  try {
    for (const [, body] of pem.matchAll(pattern)) {
      const base64 = body.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error();
      const certificate = '-----BEGIN CERTIFICATE-----\n' + base64.match(/.{1,64}/g).join('\n')
        + '\n-----END CERTIFICATE-----\n';
      certificates.push(new X509Certificate(certificate).toString());
    }
    if (!certificates.length || pem.replace(pattern, '').trim()) throw new Error();
  } catch {
    throw configurationError('DATABASE_CA_CERT_INVALID');
  }
  return certificates;
}

function connectionOptions(databaseUrl, ca) {
  if (!databaseUrl?.trim()) throw configurationError('DATABASE_URL_MISSING');
  let url, username, password, database;
  try {
    url = new URL(databaseUrl.trim());
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !username
        || !password || !database || url.hash || (url.port && Number(url.port) === 0)) {
      throw new Error();
    }
  } catch {
    throw configurationError('DATABASE_URL_INVALID');
  }
  if (url.hostname.endsWith('.pooler.supabase.com') && !/^[^.]+\.[^.]+$/.test(username)) {
    throw configurationError('DATABASE_POOLER_USER_INVALID');
  }
  const sslModes = url.searchParams.getAll('sslmode');
  if (sslModes.length > 1 || sslModes.some(mode => !['require', 'verify-ca', 'verify-full'].includes(mode))) {
    throw configurationError('DATABASE_SSLMODE_INVALID');
  }
  const certificates = normalizeCa(ca);
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  // URL query options cannot override TLS verification or transaction-pooler settings.
  return {
    host, port: Number(url.port || 5432), username, password, database,
    ssl: { rejectUnauthorized: true, ...(certificates && { ca: certificates }) },
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 5,
    idle_timeout: 20,
  };
}

async function postgresStore(databaseUrl, ca) {
  const options = connectionOptions(databaseUrl, ca);
  const { default: postgres } = await import('postgres');
  return createStore(postgres(options));
}

function createStore(sql) {
  const activeUserId = `SELECT user_id FROM ${schema}.sessions WHERE token_hash = $1 AND expires_at > $2`;
  const profileColumns = `u.id, u.email, u.name, u.salary_day, u.phone, u.payday_rule, u.payday_day,
    u.theme, u.carry_over, u.amount_mask, u.currency, u.created_at, u.updated_at, u.avatar_url, u.avatar_google_suppressed,
    g.created_at AS google_linked_at, g.verified_email AS google_email, g.avatar_url AS google_avatar_url`;
  const googleJoin = `LEFT JOIN ${schema}.google_identities g ON g.user_id = u.id`;
  return {
    async check() {
      await sql.unsafe(`SELECT ${profileColumns} FROM ${schema}.users u
        JOIN ${schema}.sessions s ON s.user_id = u.id ${googleJoin} LIMIT 0`);
    },
    close: () => sql.end(),
    async getUser(email) {
      const [user] = await sql.unsafe(`SELECT * FROM ${schema}.users WHERE email = $1`, [email]);
      return user;
    },
    async addUser(email, salt, hash, name, salaryDay) {
      const [user] = await sql.unsafe(`INSERT INTO ${schema}.users (email,password_salt,password_hash,name,salary_day)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, salt, hash, name ?? null, salaryDay ?? null]);
      return user?.id;
    },
    async getSession(hash, now) {
      const [user] = await sql.unsafe(`SELECT ${profileColumns} FROM ${schema}.users u ${googleJoin}
        WHERE u.id = (${activeUserId})`, [hash, now]);
      return user;
    },
    async updateProfile(hash, now, updates) {
      const assignments = updates.map(([column], index) => column + ' = $' + (index + 3)).join(', ');
      const [user] = await sql.unsafe(`
        WITH changed AS (
          UPDATE ${schema}.users SET ${assignments}, updated_at = clock_timestamp()
          WHERE id = (${activeUserId}) RETURNING *
        )
        SELECT ${profileColumns} FROM changed u ${googleJoin}
      `, [hash, now, ...updates.map(([, value]) => value)]);
      return user;
    },
    async purgeUser(hash, now) {
      const rows = await sql.unsafe(`DELETE FROM ${schema}.users WHERE id = (${activeUserId}) RETURNING id`, [hash, now]);
      return rows.length > 0;
    },
    async deleteSession(hash) {
      await sql.unsafe(`DELETE FROM ${schema}.sessions WHERE token_hash = $1`, [hash]);
    },
    async startGoogleFlow(hash, expires, session, now) {
      return sql.begin(async query => {
        await query.unsafe(`DELETE FROM ${schema}.google_oauth_flows WHERE expires_at <= $1`, [now]);
        await query.unsafe(`INSERT INTO ${schema}.google_oauth_flows (verifier_hash, expires_at, session_hash)
          VALUES ($1,$2,$3)`, [hash, expires, session]);
      });
    },
    async consumeGoogleFlow(hash, now) {
      const [flow] = await sql.unsafe(`DELETE FROM ${schema}.google_oauth_flows
        WHERE verifier_hash=$1 AND expires_at>$2 RETURNING session_hash`, [hash, now]);
      return flow;
    },
    async signInWithGoogle(identity, flowSession, previous, { hash, now, expires, salt, unusableHash }) {
      return sql.begin(async query => {
        await query.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['finflow-google:' + identity.subject]);
        const [linked] = await query.unsafe(`SELECT user_id FROM ${schema}.google_identities WHERE subject=$1`, [identity.subject]);
        let userId = linked?.user_id;
        if (flowSession) {
          // Consume the original live session as part of the same transaction as the link.
          // The browser's Strict session cookie can be absent on the OAuth redirect.
          const [owner] = await query.unsafe(`DELETE FROM ${schema}.sessions s USING ${schema}.users u
            WHERE s.token_hash=$1 AND s.expires_at>$2 AND s.user_id=u.id AND u.email=$3
              AND ($4::integer IS NULL OR s.user_id=$4)
              AND NOT EXISTS (SELECT 1 FROM ${schema}.google_identities g WHERE g.user_id=s.user_id AND g.subject<>$5)
            RETURNING s.user_id`, [flowSession, now, identity.email, userId ?? null, identity.subject]);
          if (!owner) return 'google_failed';
          userId = owner.user_id;
        } else if (!userId) {
          const [created] = await query.unsafe(`INSERT INTO ${schema}.users (email,password_salt,password_hash,name,salary_day,password_enabled)
            VALUES ($1,$2,$3,$4,'5-business',false) ON CONFLICT (email) DO NOTHING RETURNING id`,
          [identity.email, salt, unusableHash, identity.name]);
          if (!created) return 'google_link_required';
          userId = created.id;
        }
        if (!linked) {
          await query.unsafe(`INSERT INTO ${schema}.google_identities (subject,user_id,verified_email,avatar_url)
            VALUES ($1,$2,$3,$4)`, [identity.subject, userId, identity.email, identity.avatarUrl ?? null]);
        } else {
          await query.unsafe(`UPDATE ${schema}.google_identities SET verified_email=$2, avatar_url=$3 WHERE subject=$1`,
            [identity.subject, identity.email, identity.avatarUrl ?? null]);
        }
        if (identity.avatarUrl) {
          await query.unsafe(`UPDATE ${schema}.users SET avatar_url=$2, updated_at=clock_timestamp()
            WHERE id=$1 AND email=$3 AND avatar_url IS NULL AND NOT avatar_google_suppressed`,
          [userId, identity.avatarUrl, identity.email]);
        }
        await query.unsafe(`DELETE FROM ${schema}.sessions WHERE token_hash=$1 OR expires_at<=$2`, [previous, now]);
        await query.unsafe(`INSERT INTO ${schema}.sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)`,
          [hash, userId, expires]);
        return undefined;
      });
    },
    async rotateSession(hash, userId, expires, previous, now) {
      await sql.begin(async query => {
        await query.unsafe(`DELETE FROM ${schema}.sessions WHERE expires_at <= $1 OR token_hash = $2`, [now, previous]);
        await query.unsafe(`INSERT INTO ${schema}.sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)`,
          [hash, userId, expires]);
      });
    },
    async recordAttempt(bucket, scopes) {
      return sql.begin(async query => {
        await query.unsafe(`DELETE FROM ${schema}.auth_attempts WHERE bucket < $1`, [bucket - 1]);
        for (const [scope, limit] of scopes) {
          const rows = await query.unsafe(`INSERT INTO ${schema}.auth_attempts (bucket,scope,attempts)
            VALUES ($1,$2,1) ON CONFLICT (bucket,scope) DO UPDATE
            SET attempts = auth_attempts.attempts + 1 WHERE auth_attempts.attempts < $3 RETURNING attempts`,
          [bucket, scope, limit]);
          if (!rows.length) return false;
        }
        return true;
      });
    },
    transactions: {
      async list(userId, today = localDate()) {
        return sql.begin(async query => {
          const rules = await query.unsafe(`SELECT id, fields, next_index, next_date::text AS next_date
            FROM ${schema}.recurring_rules WHERE user_id = $1 AND next_date <= $2 ORDER BY id FOR UPDATE`, [userId, today]);
          for (const rule of rules) {
            const fields = typeof rule.fields === 'string' ? JSON.parse(rule.fields) : rule.fields;
            let index = rule.next_index;
            let date = rule.next_date;
            while (date && date <= today) {
              await insertItem(query, userId, { ...fields, date });
              date = occurrenceDate(fields.date, fields.recurrence, ++index);
            }
            await query.unsafe(`UPDATE ${schema}.recurring_rules SET next_index=$1, next_date=$2
              WHERE user_id=$3 AND id=$4`, [index, date, userId, rule.id]);
          }
          const rows = await query.unsafe(`SELECT ${columns}, ${receiptColumns} FROM ${schema}.transactions t
            ${joinReceipt} WHERE t.user_id=$1 ORDER BY t.date DESC, t.id DESC`, [userId]);
          return rows.map(itemFromRow);
        });
      },
      async create(userId, { receipt, ...fields }) {
        return sql.begin(async query => {
          await ensureReferences(query, userId, fields);
          let item;
          for (const row of transactionRows(fields)) {
            const inserted = await insertItem(query, userId, row);
            item ??= inserted;
          }
          if (fields.recurrence) {
            await query.unsafe(`INSERT INTO ${schema}.recurring_rules (user_id, fields, next_date)
              VALUES ($1,$2::jsonb,$3)`,
            [userId, JSON.stringify(fields), occurrenceDate(fields.date, fields.recurrence, 1)]);
          }
          await saveReceipt(query, userId, item, receipt);
          return item;
        });
      },
      async update(userId, id, body, maxAmount) {
        return sql.begin(async query => {
          const [row] = await query.unsafe(`SELECT ${columns}, ${receiptColumns} FROM ${schema}.transactions t
            ${joinReceipt} WHERE t.user_id=$1 AND t.id=$2 FOR UPDATE OF t`, [userId, id]);
          if (!row) return undefined;
          const current = itemFromRow(row);
          const fields = updateFields(current, body, maxAmount);
          if (!fields) return null;
          const { receipt, ...values } = fields;
          await ensureReferences(query, userId, values);
          const [updated] = await query.unsafe(`UPDATE ${schema}.transactions AS t SET type=$3, category=$4,
            amount=$5,date=$6,description=$7,payment_method=$8,status=$9,
            destination_payment_method=$10,notes=$11,updated_at=now()
            WHERE user_id=$1 AND id=$2 RETURNING ${columns}`, [userId, id, ...mutableValues(values)]);
          const item = itemFromRow(updated);
          if (current.receipt) item.receipt = current.receipt;
          await saveReceipt(query, userId, item, receipt);
          return item;
        });
      },
      async remove(userId, id) {
        const rows = await sql.unsafe(`DELETE FROM ${schema}.transactions WHERE user_id=$1 AND id=$2 RETURNING id`, [userId, id]);
        return rows.length > 0;
      },
      async receipt(userId, id) {
        const [receipt] = await sql.unsafe(`SELECT name, mime_type AS "mimeType", bytes FROM ${schema}.transaction_receipts
          WHERE user_id=$1 AND transaction_id=$2`, [userId, id]);
        return receipt;
      },
    },
  };
}

module.exports = { postgresStore, createStore, connectionOptions };
