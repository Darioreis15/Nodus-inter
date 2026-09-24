import { ForbiddenException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let prisma: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      tenant: { findUniqueOrThrow: jest.fn() },
      user: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    };
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
