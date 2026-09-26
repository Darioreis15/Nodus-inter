import { createHmac } from 'crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { seal, unseal, secretMatches } from './secrets';
import { jwtSecret } from './config';
import { publicAddress, resolveWebhook } from './safe-webhook';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { RateGuard } from './rate.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuthService } from '../auth/auth.service';
import { PrivacyController } from '../privacy/privacy.controller';
import * as bcrypt from 'bcryptjs';

describe('Security boundaries', () => {
  it('criptografa com nonce unico, autentica contexto e rejeita legado', () => {
    const a = seal('secret', 'meta:1'), b = seal('secret', 'meta:1');
    expect(a).not.toBe(b); expect(a).not.toContain('secret');
    expect(unseal(a, 'meta:1')).toBe('secret');
    expect(() => unseal(a, 'meta:2')).toThrow();
    expect(() => unseal(a.slice(0,-3) + 'xxx', 'meta:1')).toThrow();
    expect(() => unseal('legacy', 'meta:1')).toThrow();
  });
  it('recusa segredo JWT ausente ou conhecido', () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET; expect(jwtSecret).toThrow();
    process.env.JWT_SECRET = 'troque-por-um-segredo-forte-em-producao'; expect(jwtSecret).toThrow();
    process.env.JWT_SECRET = original;
    expect(secretMatches(undefined, undefined)).toBe(false);
  });
  it.each(['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','0.0.0.0','100.64.0.1'])('recusa IP nao publico %s', address => expect(publicAddress(address)).toBe(false));
  it('exige HTTPS sem credenciais e porta publica', async () => {
    await expect(resolveWebhook('http://example.com')).rejects.toThrow();
    await expect(resolveWebhook('https://user:pass@example.com')).rejects.toThrow();
    await expect(resolveWebhook('https://example.com:8080')).rejects.toThrow();
  });
  it('valida assinatura Meta sobre bytes originais', () => {
    process.env.META_APP_SECRET = 'test-meta-secret';
    const handler = jest.fn();
    const controller = new WebhooksController({ handleMetaEvent: handler } as any, {} as any);
    const rawBody = Buffer.from('{"entry":[]}');
    const signature = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex');
    controller.handleMeta({ entry: [] }, { rawBody, headers: { 'x-hub-signature-256': signature } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(() => controller.handleMeta({}, { rawBody: Buffer.from('{}'), headers: { 'x-hub-signature-256': signature } })).toThrow(UnauthorizedException);
    expect(() => controller.handleMeta({}, { rawBody, headers: {} })).toThrow(UnauthorizedException);
  });
  it('rejeita Evolution sem token e aceita segredo correto', () => {
    process.env.EVOLUTION_WEBHOOK_TOKEN = 'test-evolution-secret';
    const handler = jest.fn();
    const controller = new WebhooksController({ handleEvolutionEvent: handler } as any, {} as any);
    expect(() => controller.handleEvolution('id', {}, '')).toThrow(UnauthorizedException);
    controller.handleEvolution('id', {}, process.env.EVOLUTION_WEBHOOK_TOKEN);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('contador compartilhado continua bloqueando mesmo em outra instancia', async () => {
    let hits = 0;
    const db = { rateBucket: { upsert: jest.fn(async () => ({ hits: ++hits })) } } as any;
    const first = new RateGuard(db), second = new RateGuard(db);
    await first.consume('user:1', 2, 60000); await second.consume('user:1', 2, 60000);
    await expect(first.consume('user:1', 2, 60000)).rejects.toMatchObject({ status: 429 });
    expect(db.rateBucket.upsert.mock.calls[0][0].where.key).not.toContain('user');
  });
  it('recusa sessao revogada e usa role atual do banco', async () => {
    const db = { user: { findFirst: jest.fn().mockResolvedValue({ tokenVersion: 2, role: 'AGENT', email: 'e', mustChangePassword: false }) } };
    const strategy = new JwtStrategy(db as any);
    await expect(strategy.validate({ sub: 'u', tenantId: 't', ver: 1, role: 'ADMIN', email: 'e' })).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ sub: 'u', tenantId: 't', ver: 2, role: 'ADMIN', email: 'e' })).resolves.toMatchObject({ role: 'AGENT' });
    db.user.findFirst.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'u', tenantId: 't', ver: 2, role: 'ADMIN', email: 'e' })).rejects.toThrow();
  });
  it('recusa conta em bloqueio mesmo com tentativa de senha correta', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ lockedUntil: new Date(Date.now() + 60000) }) } };
    const jwt = { sign: jest.fn() };
    await expect(new AuthService(db as any, jwt as any).login({ email: 'e', password: 'correct' })).rejects.toThrow(UnauthorizedException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('exclusao exige senha correta, tenant correto e respeita retencao legal', async () => {
    const passwordHash = await bcrypt.hash('correct', 4);
    const db: any = { user: { findFirst: jest.fn().mockResolvedValue({ passwordHash }) }, contact: { findFirst: jest.fn().mockResolvedValue(null) }, conversation: { deleteMany: jest.fn() }, auditEvent: { create: jest.fn() } };
    db.$transaction = (fn: any) => fn(db);
    const controller = new PrivacyController(db);
    const actor = { userId: 'admin', tenantId: 'tenant', role: 'ADMIN', email: 'e' } as const;
    await expect(controller.eraseContact(actor, 'other-contact', { confirmation: 'ERASE', currentPassword: 'wrong' })).rejects.toThrow(ForbiddenException);
    await expect(controller.eraseContact(actor, 'other-contact', { confirmation: 'ERASE', currentPassword: 'correct' })).rejects.toMatchObject({ status: 404 });
    expect(db.contact.findFirst).toHaveBeenCalledWith({ where: { id: 'other-contact', tenantId: 'tenant' } });
    db.contact.findFirst.mockResolvedValue({ id: 'held', legalHold: true });
    await expect(controller.eraseContact(actor, 'held', { confirmation: 'ERASE', currentPassword: 'correct' })).rejects.toMatchObject({ status: 409 });
    expect(db.conversation.deleteMany).not.toHaveBeenCalled();
  });
});
