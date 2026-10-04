import { ForbiddenException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let prisma: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      tenant: { findUniqueOrThrow: jest.fn() },
      user: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    };
    prisma.$transaction = (fn: any) => fn(prisma);
    prisma.$queryRaw = jest.fn();
    service = new UsersService(prisma);
  });

  it('bloqueia criacao de usuario quando o plano atingiu o limite de assentos', async () => {
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({
      id: 'tenant-1',
      plan: { name: 'Starter', maxUsers: 3 },
      _count: { users: 3 },
    });

    await expect(
      service.createForTenant('tenant-1', {
        name: 'Novo Agente',
        email: 'agente@empresa.com',
        role: 'AGENT',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejeita e-mail duplicado dentro do mesmo tenant', async () => {
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({
      id: 'tenant-1',
      plan: { name: 'Starter', maxUsers: 3 },
      _count: { users: 1 },
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'ja-existe' });

    await expect(
      service.createForTenant('tenant-1', {
        name: 'Novo Agente',
        email: 'ja@empresa.com',
        role: 'AGENT',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('gera uma senha temporaria e forca troca no 1o login', async () => {
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({
      id: 'tenant-1',
      plan: { name: 'Starter', maxUsers: 3 },
      _count: { users: 1 },
    });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-2',
      name: 'Novo Agente',
      email: 'novo@empresa.com',
      role: 'AGENT',
    });

    const result = await service.createForTenant('tenant-1', {
      name: 'Novo Agente',
      email: 'novo@empresa.com',
      role: 'AGENT',
    });

    expect(result.temporaryPassword).toBeDefined();
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mustChangePassword: true, tenantId: 'tenant-1' }),
      }),
    );
  });
});


describe('Operator invitation email', () => {
  const previousEnv = process.env;
  const previousFetch = global.fetch;
  let prisma: any;
  beforeEach(() => {
    process.env = { ...previousEnv, RESEND_API_KEY: 'test-only', MAIL_FROM: 'Nodus <access@example.com>', FRONTEND_URL: 'https://app.example.com' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    prisma = {
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ plan: { maxUsers: 5 }, _count: { users: 1 } }) },
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'u', ...data })) },
    };
  });
  beforeEach(() => { prisma.$transaction = (fn: any) => fn(prisma); prisma.$queryRaw = jest.fn(); });
  afterEach(() => { process.env = previousEnv; global.fetch = previousFetch; });
  it.each([undefined, 'Chosen-password-123'])('emails the actual generated or chosen password, storing only its hash (%s)', async temporaryPassword => {
    const result = await new UsersService(prisma).createForTenant('t', { name: 'Operator', email: 'OP@EXAMPLE.COM', role: 'AGENT', temporaryPassword });
    expect(result.invitationEmailStatus).toBe('accepted');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const mail = JSON.parse(options.body);
    expect(mail.to).toEqual(['op@example.com']);
    expect(mail.text).toContain(result.temporaryPassword);
    expect(mail.text).toContain('https://app.example.com');
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('temporaryPassword');
    expect(await bcrypt.compare(result.temporaryPassword, data.passwordHash)).toBe(true);
    expect(data.mustChangePassword).toBe(true);
    if (temporaryPassword) expect(result.temporaryPassword).toBe(temporaryPassword);
  });
  it.each(['reject', 'timeout'])('keeps the account and returns a manual fallback on %s', async failure => {
    if (failure === 'reject') (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    else (global.fetch as jest.Mock).mockRejectedValue(new Error('timeout'));
    const result = await new UsersService(prisma).createForTenant('t', { name: 'Operator', email: 'op@example.com', role: 'AGENT' });
    expect(result.invitationEmailStatus).toBe('failed');
    expect(result.temporaryPassword).toBeTruthy();
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });
  it('does not send when configuration is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await new UsersService(prisma).createForTenant('t', { name: 'Operator', email: 'op@example.com', role: 'AGENT' });
    expect(result.invitationEmailStatus).toBe('not_configured');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('never sends an invitation if database creation fails', async () => {
    prisma.user.create.mockRejectedValue(new Error('database failure'));
    await expect(new UsersService(prisma).createForTenant('t', { name: 'Operator', email: 'op@example.com', role: 'AGENT' })).rejects.toThrow('database failure');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});


describe('Operator removal and seats', () => {
  let db: any;
  beforeEach(() => {
    db = {
      $queryRaw: jest.fn(),
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'agent', role: 'AGENT' }), delete: jest.fn() },
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ workspaceSettings: { timezone: 'UTC', stages: [{ id: 'sales', userId: 'agent' }, { id: 'other', userId: 'other-agent' }] } }), update: jest.fn() },
      conversation: { updateMany: jest.fn() }, auditEvent: { create: jest.fn() },
    };
    db.$transaction = (fn: any) => fn(db);
  });
  it('removes only own agent, releases assignments and stages, preserving history', async () => {
    expect(await new UsersService(db).deleteOperator('own', 'admin', 'agent')).toEqual({ deleted: true });
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: 'agent', tenantId: 'own' } });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({ where: { assignedUserId: 'agent', channel: { tenantId: 'own' } }, data: { assignedUserId: null } });
    expect(db.tenant.update.mock.calls[0][0].data.workspaceSettings).toEqual({ timezone: 'UTC', stages: [{ id: 'sales' }, { id: 'other', userId: 'other-agent' }] });
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'agent' } });
    expect(db.auditEvent.create).toHaveBeenCalledWith({ data: { tenantId: 'own', actorId: 'admin', action: 'user.deleted:agent' } });
    expect(db.$queryRaw).toHaveBeenCalled();
  });
  it('returns 404 for another tenant or missing user without mutations', async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(new UsersService(db).deleteOperator('own', 'admin', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.user.delete).not.toHaveBeenCalled(); expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });
  it.each([['ADMIN','other-admin'],['AGENT','admin']])('blocks role %s and target %s', async (role, id) => {
    db.user.findFirst.mockResolvedValue({ role, id });
    await expect(new UsersService(db).deleteOperator('own', 'admin', id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.user.delete).not.toHaveBeenCalled();
  });
  it('counts all seats and reports newly available seats from the database', async () => {
    db.tenant.findUniqueOrThrow.mockResolvedValue({ plan: { name: 'Starter', maxUsers: 3 }, _count: { users: 3 } });
    const service = new UsersService(db);
    expect(await service.limitsForTenant('own')).toEqual({ planName:'Starter', used:3, maxUsers:3, available:0 });
    db.tenant.findUniqueOrThrow.mockResolvedValue({ plan: { name: 'Starter', maxUsers: 3 }, _count: { users: 2 } });
    expect((await service.limitsForTenant('own')).available).toBe(1);
  });
});


describe('Deleted operator session', () => {
  it('rejects a previously issued JWT after the user is removed', async () => {
    const db: any = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    const strategy = new JwtStrategy(db);
    await expect(strategy.validate({ sub:'removed', tenantId:'own', ver:0, role:'AGENT', email:'op@example.com' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
