import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';

function key(): Buffer {
  const value = process.env.DATA_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Chave de criptografia invalida.');
  return Buffer.from(value, 'hex');
}
export function seal(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['enc', 'v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}
export function unseal(value: string, context: string): string {
  if (!value?.startsWith('enc:v1:')) throw new Error('Segredo legado: execute a migracao de criptografia.');
  const parts = value.split(':');
  if (parts.length !== 5) throw new Error('Segredo invalido.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[2], 'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64')), decipher.final()]).toString('utf8');
}
export function secretMatches(received: unknown, expected: string | undefined): boolean {
  if (typeof received !== 'string' || !expected) return false;
  const a = Buffer.from(received), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
