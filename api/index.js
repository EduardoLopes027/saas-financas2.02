'use strict';

const { createHandler, json } = require('../backend/auth.cjs');

let handler;
module.exports = (request, response) => {
  if (!handler) {
    try {
      const origin = new URL(process.env.APP_ORIGIN);
      if (origin.protocol !== 'https:' || origin.origin !== process.env.APP_ORIGIN) {
        throw new Error('Invalid APP_ORIGIN');
      }
      if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
      const { postgresStore } = require('../backend/postgres.cjs');
      const store = postgresStore(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);
      handler = createHandler(store, { secure: true, postgres: true, expectedOrigin: origin.origin });
    } catch {
      return json(response, 503, { error: 'service_unavailable' });
    }
  }
  return handler(request, response);
};
