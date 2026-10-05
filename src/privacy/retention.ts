import { Prisma, PrismaClient } from '@prisma/client';

type RetentionDb = Pick<PrismaClient, 'message' | 'rateBucket' | 'providerEvent' | 'auditEvent' | 'campaignDelivery'>;

export async function runRetention(db: RetentionDb, env: NodeJS.ProcessEnv, now = new Date()) {
  const messageDays = Number(env.MESSAGE_RETENTION_DAYS);
  const auditDays = Number(env.AUDIT_RETENTION_DAYS);
  const cutoff = (days: number) => new Date(now.getTime() - days * 86400000);
  if (![messageDays, auditDays].every(days => Number.isSafeInteger(days) && days >= 1 && Number.isFinite(cutoff(days).getTime()))) {
    throw new Error('Defina prazos de retencao validos e aprovados, em dias.');
  }
  const messageCutoff = cutoff(messageDays);
  const auditCutoff = cutoff(auditDays);
  const providerCutoff = cutoff(90);
  const eligible = { conversation: { contact: { legalHold: false } } };
  const messages: Prisma.MessageWhereInput = { ...eligible, createdAt: { lt: messageCutoff } };
  // Only surviving messages: deleted messages must not be counted twice.
  const raw: Prisma.MessageWhereInput = {
    ...eligible, createdAt: { gte: messageCutoff }, raw: { not: Prisma.AnyNull },
  };
  const buckets = { expiresAt: { lt: now } };
  const providers = { createdAt: { lt: providerCutoff } };
  const audits = { createdAt: { lt: auditCutoff } };
  const deliveries = { status:{notIn:['QUEUED','SENDING']}, finishedAt:{lt:messageCutoff}, contact:{legalHold:false}, campaign:{deliveries:{none:{status:{in:['QUEUED','SENDING']}}}} };
  const apply = env.APPLY_RETENTION === 'true';
  const counts = apply ? [
    (await db.message.deleteMany({ where: messages })).count,
    (await db.message.updateMany({ where: raw, data: { raw: Prisma.DbNull } })).count,
    (await db.rateBucket.deleteMany({ where: buckets })).count,
    (await db.providerEvent.deleteMany({ where: providers })).count,
    (await db.auditEvent.deleteMany({ where: audits })).count,
    (await db.campaignDelivery.deleteMany({ where: deliveries })).count,
  ] : await Promise.all([
    db.message.count({ where: messages }),
    db.message.count({ where: raw }),
    db.rateBucket.count({ where: buckets }),
    db.providerEvent.count({ where: providers }),
    db.auditEvent.count({ where: audits }),
    db.campaignDelivery.count({ where: deliveries }),
  ]);
  return {
    mode: apply ? 'APPLIED' : 'DRY_RUN',
    referenceTime: now.toISOString(),
    cutoffs: { messages: messageCutoff.toISOString(), auditEvents: auditCutoff.toISOString(), providerEvents: providerCutoff.toISOString() },
    counts: {
      messages: counts[0], rawPayloads: counts[1], expiredRateBuckets: counts[2],
      providerEvents: counts[3], auditEvents: counts[4], campaignDeliveries: counts[5],
    },
  };
}
