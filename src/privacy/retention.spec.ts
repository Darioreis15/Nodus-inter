import { Prisma, PrismaClient } from '@prisma/client';
import { runRetention } from './retention';

describe('retention', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const env = { MESSAGE_RETENTION_DAYS: '30', AUDIT_RETENTION_DAYS: '90' };
  function database() {
    const model = () => ({ count: jest.fn().mockResolvedValue(3), deleteMany: jest.fn().mockResolvedValue({ count: 2 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
    return { message: model(), rateBucket: model(), providerEvent: model(), auditEvent: model(), campaignDelivery:model() };
  }
  it('previews every operation without writing, excludes held contacts and avoids raw double counting', async () => {
    const db = database();
    const result = await runRetention(db as unknown as PrismaClient, env, now);
    expect(result.mode).toBe('DRY_RUN');
    expect(result.counts).toEqual({ messages: 3, rawPayloads: 3, expiredRateBuckets: 3, providerEvents: 3, auditEvents: 3, campaignDeliveries:3 });
    expect(db.message.count).toHaveBeenNthCalledWith(1, { where: { conversation: { contact: { legalHold: false } }, createdAt: { lt: new Date('2026-08-29T12:00:00Z') } } });
    expect(db.message.count).toHaveBeenNthCalledWith(2, { where: { conversation: { contact: { legalHold: false } }, createdAt: { gte: new Date('2026-08-29T12:00:00Z') }, raw: { not: Prisma.AnyNull } } });
    for (const model of Object.values(db)) {
      expect(model.deleteMany).not.toHaveBeenCalled();
      expect(model.updateMany).not.toHaveBeenCalled();
    }
  });
  it('applies the same predicates and reports actual affected counts', async () => {
    const db = database();
    await runRetention(db as unknown as PrismaClient, env, now);
    const result = await runRetention(db as unknown as PrismaClient, { ...env, APPLY_RETENTION: 'true' }, now);
    expect(result.mode).toBe('APPLIED');
    expect(result.counts).toEqual({ messages: 2, rawPayloads: 1, expiredRateBuckets: 2, providerEvents: 2, auditEvents: 2, campaignDeliveries:2 });
    expect(db.message.deleteMany).toHaveBeenCalledWith(db.message.count.mock.calls[0][0]);
    expect(db.message.updateMany).toHaveBeenCalledWith({ ...db.message.count.mock.calls[1][0], data: { raw: Prisma.DbNull } });
    for (const model of [db.rateBucket, db.providerEvent, db.auditEvent, db.campaignDelivery]) {
      expect(model.deleteMany).toHaveBeenCalledWith(model.count.mock.calls[0][0]);
    }
  });
  it.each(['', '0', '-1', '1.5', 'abc', '999999999999999999'])('rejects invalid retention %s before accessing data', async value => {
    const db = database();
    await expect(runRetention(db as unknown as PrismaClient, { ...env, AUDIT_RETENTION_DAYS: value }, now)).rejects.toThrow('prazos');
    for (const model of Object.values(db)) expect(model.count).not.toHaveBeenCalled();
  });
  it('does not interpret other flag values as permission to delete', async () => {
    const db = database();
    expect((await runRetention(db as unknown as PrismaClient, { ...env, APPLY_RETENTION: 'TRUE' }, now)).mode).toBe('DRY_RUN');
    expect(db.message.deleteMany).not.toHaveBeenCalled();
  });
});
