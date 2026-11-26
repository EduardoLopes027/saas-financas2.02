'use strict';

const columns = {
  displayName: 'name',
  phone: 'phone',
  paydayRule: 'payday_rule',
  paydayDay: 'payday_day',
  theme: 'theme',
  carryOver: 'carry_over',
  amountMask: 'amount_mask',
  currency: 'currency',
};

const validators = {
  displayName: value => typeof value === 'string' && value.trim().length > 0
    && value.trim().length <= 120 && !/[\x00-\x1f\x7f]/.test(value),
  phone: value => value === null || (typeof value === 'string' && /^[\d+(). -]{0,32}$/.test(value)),
  paydayRule: value => ['fixed', 'fifth_business_day'].includes(value),
  paydayDay: value => Number.isInteger(value) && value >= 1 && value <= 31,
  theme: value => ['light', 'dark'].includes(value),
  carryOver: value => typeof value === 'boolean',
  amountMask: value => typeof value === 'boolean',
  currency: value => value === 'BRL',
};

function profileUpdates(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const entries = Object.entries(body);
  if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(validators, key) || !validators[key](value))) {
    return undefined;
  }
  return entries.map(([key, value]) => [
    columns[key], typeof value === 'string' ? value.trim() : value,
  ]);
}

function userProfile(user, googleAvailable) {
  const paydayRule = user.payday_rule ?? (
    user.salary_day && !['5', '5-business'].includes(user.salary_day) ? 'fixed' : 'fifth_business_day'
  );
  const paydayDay = user.payday_day ?? (Number(user.salary_day) || 5);
  const salaryDay = user.payday_rule || user.payday_day != null
    ? (paydayRule === 'fixed' ? String(paydayDay) : '5-business')
    : user.salary_day;
  const googleLinked = user.google_linked_at != null;
  const emailVerified = googleLinked && user.google_email === user.email;
  return {
    id: user.id, email: user.email, ...(user.name && { name: user.name }),
    ...(salaryDay && { salaryDay }), displayName: user.name ?? '', phone: user.phone ?? '',
    paydayRule, paydayDay, theme: user.theme, carryOver: Boolean(user.carry_over),
    amountMask: Boolean(user.amount_mask), currency: user.currency,
    createdAt: user.created_at ?? null, updatedAt: user.updated_at ?? user.created_at ?? null,
    emailVerified, googleAvailable, googleLinked,
    googleEmail: googleLinked ? user.google_email : null,
    googleLinkedAt: user.google_linked_at ?? null,
    googleAvatarUrl: emailVerified ? user.google_avatar_url : null,
  };
}

module.exports = { profileUpdates, userProfile };
