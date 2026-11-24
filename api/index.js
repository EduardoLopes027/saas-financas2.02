'use strict';

const { createHandler, json } = require('../backend/auth.cjs');

const reasons = new Map(Object.entries({
  APP_ORIGIN_MISSING: 'APP_ORIGIN is missing',
  APP_ORIGIN_INVALID: 'APP_ORIGIN must be an HTTPS origin without a path, query, or credentials',
  DATABASE_URL_MISSING: 'DATABASE_URL is missing',
  DATABASE_URL_INVALID: 'DATABASE_URL must contain a PostgreSQL host, user, password, and database',
  DATABASE_POOLER_USER_INVALID: 'Supabase shared pooler requires role.project_ref as the username',
  DATABASE_SSLMODE_INVALID: 'Use sslmode=require, verify-ca, or verify-full, or omit sslmode',
  DATABASE_CA_CERT_INVALID: 'DATABASE_CA_CERT is not a valid PEM certificate or chain',
  MODULE_NOT_FOUND: 'A backend dependency could not be loaded',
  CONNECT_TIMEOUT: 'Timed out connecting to PostgreSQL',
  CONNECTION_CLOSED: 'The PostgreSQL connection closed',
  CONNECTION_ENDED: 'The PostgreSQL connection ended',
  ECONNREFUSED: 'The PostgreSQL endpoint refused the connection',
  ECONNRESET: 'The PostgreSQL endpoint reset the connection',
  ETIMEDOUT: 'The PostgreSQL connection timed out',
  ENETUNREACH: 'The PostgreSQL network is unreachable',
  ENOTFOUND: 'The PostgreSQL hostname could not be resolved',
  EAI_AGAIN: 'PostgreSQL hostname resolution failed temporarily',
  SELF_SIGNED_CERT_IN_CHAIN: 'The PostgreSQL TLS chain requires a trusted CA certificate',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The PostgreSQL endpoint presented an untrusted self-signed certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The PostgreSQL TLS chain could not be verified',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The PostgreSQL TLS issuer is missing from the CA chain',
  CERT_HAS_EXPIRED: 'A PostgreSQL TLS certificate has expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The PostgreSQL hostname does not match the TLS certificate',
  SSL_NOT_SUPPORTED: 'The PostgreSQL endpoint does not support TLS',
  '28P01': 'PostgreSQL rejected the database password',
  '28000': 'PostgreSQL rejected the login role',
  '3D000': 'The configured database does not exist',
  '3F000': 'The FinFlow schema does not exist',
  '42P01': 'A required FinFlow table is missing; apply supabase/schema.sql',
  '42501': 'The database role lacks permissions on the FinFlow schema or tables',
  '53300': 'PostgreSQL has no available connections',
  '57P03': 'PostgreSQL is not accepting connections',
}));

function reportInitializationError(error) {
  const reported = error?.code;
  const code = typeof reported === 'string' && (reasons.has(reported)
    || /^(?:[0-9A-Z]{5}|ERR_(?:TLS|SSL)_[A-Z0-9_]+)$/.test(reported)) ? reported : 'UNKNOWN';
  const poolerReason = /tenant or user not found/i.test(error?.message ?? '')
    ? 'Supabase pooler could not find the project or login role' : undefined;
  // The driver error message and stack can contain connection details.
  console.error('[finflow/api] Initialization failed [' + code + ']: '
    + (reasons.get(code) ?? poolerReason ?? 'PostgreSQL or API initialization failed'));
}

function configuredOrigin(value) {
  if (!value?.trim()) throw Object.assign(new Error(), { code: 'APP_ORIGIN_MISSING' });
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:' && [url.origin, url.origin + '/'].includes(value.trim())) return url.origin;
  } catch {
    // Convert potentially sensitive URL parser errors to a fixed code.
  }
  throw Object.assign(new Error(), { code: 'APP_ORIGIN_INVALID' });
}

async function initialize() {
  let store;
  try {
    const { postgresStore } = require('../backend/postgres.cjs');
    store = postgresStore(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);
    const origin = configuredOrigin(process.env.APP_ORIGIN);
    await store.check();
    return createHandler(store, { secure: true, postgres: true, expectedOrigin: origin });
  } catch (error) {
    reportInitializationError(error);
    await store?.close().catch(() => {});
    return null;
  }
}

let initialization;
module.exports = async (request, response) => {
  initialization ??= initialize().then(handler => {
    if (!handler) initialization = undefined;
    return handler;
  });
  const handler = await initialization;
  if (!handler) return json(response, 503, { error: 'service_unavailable' });
  return handler(request, response);
};
