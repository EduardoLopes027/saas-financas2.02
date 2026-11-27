'use strict';

const { challenge } = require('./google-oauth.cjs');

const recoveryCallback = '/api/auth/recovery/callback';
const resetPath = '/api/auth/reset-password';
const recoveryFailed = '/?auth_error=recovery_failed#login';
const recoveryForm = '/#redefinir-senha';
const grantSeconds = 300;
const attemptSeconds = 900;
const randomTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recoveryCookie(value, seconds = grantSeconds) {
  return '__Host-finflow_recovery=' + value + '; Path=/'
    + '; HttpOnly; Secure; SameSite=Strict; Max-Age=' + seconds;
}

function readRecoveryCookie(request) {
  const matches = (request.headers.cookie ?? '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith('__Host-finflow_recovery='));
  const token = matches.length === 1 ? matches[0].slice('__Host-finflow_recovery='.length) : '';
  return randomTokenPattern.test(token) ? token : null;
}

function recoveryClient(projectUrl, key, origin, request = fetch) {
  if (!projectUrl || !key) return undefined;
  const project = new URL(projectUrl);
  const app = new URL(origin);
  if (project.protocol !== 'https:' || ![project.origin, project.origin + '/'].includes(projectUrl)
      || app.protocol !== 'https:' || app.origin !== origin) {
    throw new Error('Invalid recovery origin');
  }
  const base = project.origin + '/auth/v1';
  const post = (path, body) => request(base + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    async send(email, state, verifier) {
      const callback = new URL(recoveryCallback, app);
      callback.searchParams.set('state', state);
      const params = new URLSearchParams({ redirect_to: callback.href });
      const response = await post('/recover?' + params, {
        email, code_challenge: challenge(verifier), code_challenge_method: 's256',
      });
      if (!response.ok) throw new Error('Provider recovery request failed');
    },
    async verify(code, verifier) {
      // Only /recover sees the challenge for this verifier. A code from OAuth,
      // magic-link or another recovery attempt cannot redeem this challenge.
      const response = await post('/token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
      if (!response.ok) return undefined;
      const { user, access_token: accessToken } = await response.json();
      if (!user || typeof user.id !== 'string' || !uuid.test(user.id) || !user.email_confirmed_at
          || typeof user.email !== 'string' || typeof accessToken !== 'string') return undefined;
      // Read only the token returned by this authenticated TLS exchange. No browser-supplied JWT is accepted.
      const parts = accessToken.split('.');
      if (parts.length !== 3 || !parts[1]) return undefined;
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (claims.sub !== user.id || !Array.isArray(claims.amr)
          || !claims.amr.some(entry => entry?.method === 'recovery')) return undefined;
      const email = user.email.trim().toLowerCase();
      const google = Array.isArray(user.identities)
        ? user.identities.filter(identity => identity?.provider === 'google') : [];
      const data = google.length === 1 ? google[0].identity_data : undefined;
      const subject = data?.email_verified === true && typeof data.email === 'string'
        && data.email.trim().toLowerCase() === email && typeof data.sub === 'string' ? data.sub : null;
      return { id: user.id.toLowerCase(), email, subject };
    },
  };
}

module.exports = {
  attemptSeconds, grantSeconds, randomTokenPattern, readRecoveryCookie,
  recoveryCallback, recoveryClient, recoveryCookie, recoveryFailed, recoveryForm, resetPath,
};
