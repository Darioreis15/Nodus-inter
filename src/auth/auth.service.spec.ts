import { UnauthorizedException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let prisma: any;
  let jwt: any;
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      $executeRaw: jest.fn(),
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    service = new AuthService(prisma, jwt);
  });

  describe('registerTenant', () => {
    it('rejeita e-mail ja cadastrado', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.registerTenant({
          companyName: 'Clinica Boa Saude',
          adminName: 'Ana',
          adminEmail: 'ana@existente.com',
          password: 'senha1234',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('gera slug unico a partir do nome da empresa, evitando colisao', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.plan.findUnique.mockResolvedValue({ id: 'plan-starter' });
      // primeiro slug ja existe, segundo (com sufixo) esta livre
      prisma.tenant.findUnique
        .mockResolvedValueOnce({ id: 'ja-existe' })
        .mockResolvedValueOnce(null);
      prisma.tenant.create.mockResolvedValue({
        id: 'tenant-1',
        name: 'Clinica Boa Saude',
        slug: 'clinica-boa-saude-2',
        users: [
          {
            id: 'user-1',
            name: 'Ana',
            email: 'ana@nova.com',
            role: 'ADMIN',
            mustChangePassword: false,
          },
        ],
      });

      const result = await service.registerTenant({
        companyName: 'Clinica Boa Saude',
        adminName: 'Ana',
        adminEmail: 'ana@nova.com',
        password: 'senha1234',
      });

      expect(prisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'clinica-boa-saude-2' }),
        }),
      );
      expect(result.tenant.slug).toBe('clinica-boa-saude-2');
    });
  });

  describe('login', () => {
    it('rejeita usuario inexistente', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ninguem@nodus.dev', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('incrementa contador de tentativas na senha errada', async () => {
      const passwordHash = await bcrypt.hash('senha-correta', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'admin@demo.nodus.dev',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: false,
        failedLoginCount: 2,
      });

      await expect(
        service.login({ email: 'admin@demo.nodus.dev', password: 'senha-errada' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('retorna token e mustChangePassword na senha correta', async () => {
      const passwordHash = await bcrypt.hash('senha-correta', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        name: 'Admin Demo',
        email: 'admin@demo.nodus.dev',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true,
        failedLoginCount: 0,
        tenant: { status: 'ACTIVE' },
      });

      const result = await service.login({
        email: 'admin@demo.nodus.dev',
        password: 'senha-correta',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.mustChangePassword).toBe(true);
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', tenantId: 'tenant-1', role: 'ADMIN' }),
      );
    });

    it('bloqueia login de tenant suspenso por inadimplencia', async () => {
      const passwordHash = await bcrypt.hash('senha-correta', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'admin@demo.nodus.dev',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: false,
        failedLoginCount: 0,
        tenant: { status: 'SUSPENDED' },
      });

      await expect(
        service.login({ email: 'admin@demo.nodus.dev', password: 'senha-correta' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
