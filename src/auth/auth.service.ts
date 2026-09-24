import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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

    const passwordHash = await bcrypt.hash(dto.password, 10);

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
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { tenant: { select: { status: true } } },
    });
    if (!user) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
      });
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    if (user.tenant.status === 'SUSPENDED') {
      throw new ForbiddenException(
        'Sua empresa esta com o acesso suspenso por pendencia financeira. Regularize a assinatura para continuar.',
      );
    }

    if (user.failedLoginCount > 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0 },
      });
    }

    const accessToken = this.issueToken(user.id, user.tenantId, user.role, user.email);

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

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
    });

    return { message: 'Senha atualizada com sucesso.' };
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
      },
    };
  }

  private issueToken(userId: string, tenantId: string, role: string, email: string): string {
    return this.jwt.sign({ sub: userId, tenantId, role, email });
  }

  private toPublicUser(user: {
    id: string;
    name: string;
    email: string;
    role: string;
    mustChangePassword: boolean;
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
