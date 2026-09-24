import { ConflictException, Injectable, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async listForTenant(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });

    return users.map((u: (typeof users)[number]) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
    }));
  }

  async createForTenant(tenantId: string, dto: CreateUserDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true, _count: { select: { users: true } } },
    });

    if (tenant._count.users >= tenant.plan.maxUsers) {
      throw new ForbiddenException(
        `Limite de usuarios do plano ${tenant.plan.name} atingido (${tenant.plan.maxUsers}).`,
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Ja existe uma conta com esse e-mail.');
    }

    const temporaryPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        role: dto.role,
        passwordHash,
        mustChangePassword: true,
      },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      temporaryPassword, // exibir uma unica vez para o admin repassar ao novo agente
    };
  }
}
