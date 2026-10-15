import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { OwnerCompaniesService } from './owner-companies.service';
import { CreateCompanyDto } from './create-company.dto';

describe('Owner company creation', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const previous = process.env.PLATFORM_OWNER_USER_ID;
  let prisma: any, users: any, actor: any, plan: any, service: OwnerCompaniesService, committed: boolean;
  const dto = () => ({ companyName: 'Nova Empresa', adminName: 'Primeiro Admin', adminEmail: 'Admin@Example.com',
    planId, sendInvitation: true, currentPassword: 'owner-password', confirmation: 'CREATE_COMPANY' });
  beforeEach(() => {
    process.env.PLATFORM_OWNER_USER_ID = owner; committed = false;
    actor = { id: owner, role: 'ADMIN', passwordHash: bcrypt.hashSync('owner-password', 4), tokenVersion: 1 };
    plan = { id: planId, name: 'Starter', priceCents: 9900, maxUsers: 3, maxChannels: 1 };
    prisma = {
      user: { findUnique: jest.fn(({ where }: any) => where.id ? actor : null) },
      plan: { findUnique: jest.fn(() => plan) },
      tenant: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(({ data }: any) => ({
        id: 'new-tenant', name: data.name, slug: data.slug, status: data.status, plan,
        users: [{ id: 'new-admin', name: data.users.create.name, email: data.users.create.email,
          role: data.users.create.role, isOwner: data.users.create.isOwner, mustChangePassword: data.users.create.mustChangePassword }],
      })) }, auditEvent: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn: any) => { const result = await fn(prisma); committed = true; return result; });
    users = { sendInvitation: jest.fn(() => { expect(committed).toBe(true); return 'accepted'; }) };
    service = new OwnerCompaniesService(prisma, users);
  });
  afterAll(() => { if (previous === undefined) delete process.env.PLATFORM_OWNER_USER_ID; else process.env.PLATFORM_OWNER_USER_ID = previous; });
  it('creates selected plan, protected admin and generated password, then invites after commit', async () => {
    const result = await service.create(owner, dto());
    expect(result).toMatchObject({ tenant: { id: 'new-tenant', status: 'ACTIVE', plan: { id: planId } },
      user: { email: 'admin@example.com', role: 'ADMIN', isOwner: true, mustChangePassword: true }, invitationEmailStatus: 'accepted', contractCreated: false });
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const write = prisma.tenant.create.mock.calls[0][0].data;
    expect(await bcrypt.compare(result.temporaryPassword, write.users.create.passwordHash)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(write).not.toHaveProperty('subscription');
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: { tenantId: 'new-tenant', actorId: owner, action: `owner.company_created:${planId}` } });
    expect(users.sendInvitation).toHaveBeenCalledWith(result.user, result.temporaryPassword);
  });
  it('accepts a supplied temporary password without sending an unwanted invitation', async () => {
    const result = await service.create(owner, { ...dto(), temporaryPassword: 'temporary-password', sendInvitation: false });
    expect(result).toMatchObject({ temporaryPassword: 'temporary-password', invitationEmailStatus: 'not_requested' });
    expect(users.sendInvitation).not.toHaveBeenCalled();
  });
  it('rejects non-owner, incorrect password or confirmation without writes or emails', async () => {
    await expect(service.create(owner, { ...dto(), currentPassword: 'wrong' })).rejects.toThrow('Senha');
    await expect(service.create(owner, { ...dto(), confirmation: 'wrong' })).rejects.toThrow();
    actor.id = 'someone'; await expect(service.create('someone', dto())).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(users.sendInvitation).not.toHaveBeenCalled();
  });
  it('rechecks owner session in the transaction', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ ...actor }).mockResolvedValueOnce({ ...actor, tokenVersion: 2 });
    await expect(service.create(owner, dto())).rejects.toThrow('Entre novamente');
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
  it('rejects already registered email ignoring capitalization', async () => {
    prisma.user.findUnique.mockImplementation(({ where }: any) => where.id ? actor : { id: 'existing' });
    await expect(service.create(owner, dto())).rejects.toThrow('Ja existe');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'admin@example.com' } });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
  it('rejects unknown plans and plans without room for the administrator', async () => {
    plan = null; await expect(service.create(owner, dto())).rejects.toThrow('Plano nao encontrado');
    plan = { id: planId, maxUsers: 0 }; await expect(service.create(owner, dto())).rejects.toThrow('ao menos');
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
  it('handles equal company names with a different identifier', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'existing' });
    const result = await service.create(owner, dto());
    expect(result.tenant.slug).toMatch(/^nova-empresa-[a-f0-9]{12}$/);
  });
  it('concurrent uniqueness failure becomes conflict and never sends invitation', async () => {
    prisma.tenant.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create(owner, dto())).rejects.toThrow('ja cadastrado');
    expect(committed).toBe(false); expect(users.sendInvitation).not.toHaveBeenCalled();
  });
  it('audit/database failure never sends email', async () => {
    prisma.auditEvent.create.mockRejectedValue(new Error('database unavailable'));
    await expect(service.create(owner, dto())).rejects.toThrow('database unavailable');
    expect(committed).toBe(false); expect(users.sendInvitation).not.toHaveBeenCalled();
  });
  it('email delivery failure does not undo the company or conceal temporary access', async () => {
    users.sendInvitation.mockResolvedValue('failed');
    expect(await service.create(owner, dto())).toMatchObject({ tenant: { id: 'new-tenant' }, invitationEmailStatus: 'failed' });
    expect(committed).toBe(true);
  });
  it('validates normalized identity, password byte limit and rejects injected privilege fields', async () => {
    const valid = plainToInstance(CreateCompanyDto, { ...dto(), companyName: '  Empresa  ', adminEmail: ' ADMIN@EXAMPLE.COM ' });
    expect(await validate(valid, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(valid.adminEmail).toBe('admin@example.com'); expect(valid.companyName).toBe('Empresa');
    for (const patch of [{ companyName: '  ' }, { adminEmail: 'invalid' }, { temporaryPassword: 'short' }, { temporaryPassword: 'é'.repeat(37) }, { sendInvitation: 'true' }, { isOwner: false }, { status: 'SUSPENDED' }]) {
      const invalid = plainToInstance(CreateCompanyDto, { ...dto(), ...patch });
      expect((await validate(invalid, { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    }
  });
});
