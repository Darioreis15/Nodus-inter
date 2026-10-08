/** UI phone input: local Brazilian DDD + number, or explicit international +DDI. */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const input = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(input)) return value;
  const digits = input.replace(/\D/g, '');
  if (input.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
  if (/^[1-9]\d{9,10}$/.test(digits)) return `55${digits}`;
  if (/^55[1-9]\d{9,10}$/.test(digits)) return digits;
  return ''; // Other countries must explicitly supply +DDI; never guess their country.
}
