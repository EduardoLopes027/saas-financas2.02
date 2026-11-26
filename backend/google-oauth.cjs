'use strict';

const { createHash, randomBytes } = require('node:crypto');

const callbackPath = '/api/auth/google/callback';
const cookieName = '__Host-finflow_google';
const flowSeconds = 300;
const failure = '/?auth_error=google_failed#login';

function challenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function flowCookie(value, maxAge = flowSeconds) {
  return cookieName + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}

function redirect(response, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  return response.writeHead(303, headers).end();
}

function googleClient(projectUrl, key, origin, request = fetch) {
  if (!projectUrl || !key) return undefined;
  const project = new URL(projectUrl);
  if (project.protocol !== 'https:' || ![project.origin, project.origin + '/'].includes(projectUrl)) {
    throw new Error('Invalid SUPABASE_URL');
  }
  const base = project.origin + '/auth/v1';
  const headers = { apikey: key };
  return {
    authorize(verifier) {
      const params = new URLSearchParams({
        provider: 'google', redirect_to: origin + callbackPath,
        code_challenge: challenge(verifier), code_challenge_method: 's256',
        prompt: 'select_account',
      });
      return base + '/authorize?' + params;
    },
    async identity(code, verifier) {
      const exchange = await request(base + '/token?grant_type=pkce', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      });
      if (!exchange.ok) return undefined;
      const { access_token: token } = await exchange.json();
      if (typeof token !== 'string' || !token) return undefined;
      const user = await request(base + '/user', {
        redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { ...headers, Authorization: 'Bearer ' + token },
      });
      if (!user.ok) return undefined;
      const { identities } = await user.json();
      const google = Array.isArray(identities) ? identities.filter(item => item.provider === 'google') : [];
      if (google.length !== 1) return undefined;
      const { sub, email, email_verified: verified, name, full_name: fullName, avatar_url: avatar, picture } = google[0].identity_data ?? {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (verified !== true || typeof sub !== 'string' || !/^[^\s\x00-\x1f\x7f]{1,255}$/.test(sub)
          || normalizedEmail.length > 254 || !/^[^\s@\x00]+@[^\s@\x00]+\.[^\s@\x00]+$/.test(normalizedEmail)) return undefined;
      const displayName = [name, fullName].find(value => typeof value === 'string' && value.trim());
      const avatarUrl = [avatar, picture].find(value => typeof value === 'string' && value.length <= 2048
        && /^https:\/\/lh[0-9]+\.googleusercontent\.com\/[a-z0-9/_=.%-]+$/i.test(value));
      return {
        subject: sub, email: normalizedEmail,
        name: displayName?.replace(/\x00/g, '').trim().slice(0, 120) || null, avatarUrl,
      };
    },
  };
}

function newFlow() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, hash: challenge(verifier), expires: Date.now() + flowSeconds * 1000 };
}

function readFlow(request) {
  return (request.headers.cookie ?? '').match(/(?:^|;\s*)__Host-finflow_google=([\w-]{43})(?=;|$)/)?.[1];
}

module.exports = { callbackPath, challenge, failure, flowCookie, googleClient, newFlow, readFlow, redirect };
