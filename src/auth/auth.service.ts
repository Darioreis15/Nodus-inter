import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async registerTenant(dto: RegisterTenantDto) {
    dto.adminEmail = dto.adminEmail.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.adminEmail } });
    if (existingUser) {
      throw new ConflictException('Ja existe uma conta com esse e-mail.');
    }

    const starterPlan = await this.prisma.plan.findUnique({ where: { slug: 'starter' } });
    if (!starterPlan) {
      throw new NotFoundException(
        'Plano "starter" nao encontrado. Rode o seed antes de registrar um tenant.',
      );
    }

    const baseSlug = slugify(dto.companyName);
    let slug = baseSlug;
    let suffix = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.companyName,
        slug,
        planId: starterPlan.id,
        users: {
          create: {
            name: dto.adminName,
            email: dto.adminEmail,
            passwordHash,
            role: 'ADMIN',
            isOwner: true,
            mustChangePassword: false, // ja definiu a propria senha no cadastro
          },
        },
      },
      include: { users: true },
    });

    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: this.toPublicUser(tenant.users[0]),
    };
  }

  async login(dto: LoginDto) {
    dto.email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { tenant: { select: { status: true } } },
    });
    if (!user) {
      await bcrypt.compare(dto.password, '$2b$12$abcdefghijklmnopqrstuu0nP8uVhUN9Kau3QyTUFXKYmo20DY/yG');
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) throw new UnauthorizedException('Credenciais invalidas ou acesso temporariamente bloqueado.');
    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.prisma.$executeRaw`
        UPDATE users SET failed_login_count = CASE WHEN locked_until <= NOW() THEN 1 ELSE failed_login_count + 1 END,
        locked_until = CASE WHEN locked_until <= NOW() THEN NULL
          WHEN failed_login_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END
        WHERE id = ${user.id}`;
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    if (user.tenant.status === 'SUSPENDED' && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Sua empresa esta com o acesso suspenso por pendencia financeira. Regularize a assinatura para continuar.',
      );
    }

    if (user.failedLoginCount > 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    const accessToken = this.issueToken(user.id, user.tenantId, user.role, user.email, user.tokenVersion);

    return {
      accessToken,
      mustChangePassword: user.mustChangePassword,
      user: this.toPublicUser(user),
    };
  }

  async changePassword(authUser: AuthenticatedUser, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.userId } });

    const currentMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
    });

    return { message: 'Senha atualizada com sucesso.' };
  }

  async changeEmail(authUser: AuthenticatedUser, dto: ChangeEmailDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.userId } });
    if (user.tenantId !== authUser.tenantId || !await bcrypt.compare(dto.currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }
    if (email === user.email) return { updated: false };
    try {
      await this.prisma.$transaction(async tx => {
        // Optimistic check prevents an old session from racing a password/email change.
        const result = await tx.user.updateMany({ where: { id: user.id, tokenVersion: user.tokenVersion, passwordHash: user.passwordHash },
          data: { email, tokenVersion: { increment: 1 } } });
        if (!result.count) throw new UnauthorizedException('Sessao alterada. Entre novamente.');
        await tx.passwordReset.deleteMany({ where: { userId: user.id } });
        await tx.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.id, action: 'account.email_changed' } });
      });
    } catch (error) {
      if ((error as any)?.code === 'P2002') throw new ConflictException('Este e-mail ja esta em uso.');
      throw error;
    }
    return { updated: true };
  }

  async logoutAll(user: AuthenticatedUser) {
    await this.prisma.user.update({ where: { id: user.userId }, data: { tokenVersion: { increment: 1 } } });
    return { revoked: true };
  }

  async me(authUser: AuthenticatedUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: authUser.userId },
      include: { tenant: { include: { plan: true } } },
    });

    return {
      user: this.toPublicUser(user),
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        plan: user.tenant.plan.name,
        status: user.tenant.status,
      },
    };
  }

  private issueToken(userId: string, tenantId: string, role: string, email: string, ver: number): string {
    return this.jwt.sign({ sub: userId, tenantId, role, email, ver });
  }

  private toPublicUser(user: {
    id: string;
    name: string;
    email: string;
    role: string;
    mustChangePassword: boolean;
    isOwner?: boolean;
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isOwner: user.isOwner === true,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
