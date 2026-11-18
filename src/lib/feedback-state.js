const IDENTITY_LIMITS = { firstName: 80, lastName: 80, schoolId: 160, otherName: 160 };

// Local storage is user-controlled and may contain an older or damaged shape.
export function sanitizeIdentity(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(IDENTITY_LIMITS).map(([key, limit]) => [
    key, typeof source[key] === 'string' ? source[key].slice(0, limit) : '',
  ]));
}

export function sanitizeSentCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, count]) =>
    /^[a-z0-9-]+$/.test(id) && Number.isSafeInteger(count) && count >= 0 && count < Number.MAX_SAFE_INTEGER,
  ));
}
