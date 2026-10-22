import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';

const BRAZIL_DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));

/** Only E.164 Brazilian mobile aliases; never strip digits from arbitrary IDs/groups. */
export function phoneAliases(phone: string): string[] {
  const match = /^55(\d{2})(9?[6-9]\d{7})$/.exec(phone);
  if (!match || !BRAZIL_DDDS.has(match[1])) return [phone];
  const local = match[2].length === 9 ? match[2].slice(1) : match[2];
  return [...new Set([phone, `55${match[1]}${local}`, `55${match[1]}9${local}`])];
}

/** Caller holds the tenant row lock, so alias lookup and creation are atomic. */
export async function resolveContact(tx: Prisma.TransactionClient, tenantId: string, channelId: string, phone: string, name?: string) {
  const aliases = phoneAliases(phone);
  const where = { tenantId, waId: { in: aliases } };
  // Prefer the contact already being served on this channel, including legacy duplicates.
  const active = await tx.contact.findFirst({ where: { ...where, conversations: { some: { channelId, status: { in: ['OPEN', 'PENDING'] } } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (active) return active;
  const existing = await tx.contact.findFirst({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (existing) return existing;
  return tx.contact.upsert({ where: { tenantId_waId: { tenantId, waId: phone } }, create: { tenantId, waId: phone, name: name || null }, update: {} });
}

export async function isPhoneSuppressed(db: Pick<Prisma.TransactionClient, 'campaignSuppression'>, tenantId:string, phone:string) {
  for (const alias of phoneAliases(phone)) {
    const phoneHash = createHash('sha256').update(`${tenantId}:${alias}`).digest('hex');
    if (await db.campaignSuppression.findUnique({where:{tenantId_phoneHash:{tenantId,phoneHash}}})) return true;
  }
  return false;
}
