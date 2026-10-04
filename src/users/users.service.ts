import { ConflictException, Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
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
      availability: u.availability,
    }));
  }

  async createForTenant(tenantId: string, dto: CreateUserDto) {
    dto.email = dto.email.trim().toLowerCase();
    const temporaryPassword = dto.temporaryPassword || crypto.randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const user = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        include: { plan: true, _count: { select: { users: true } } },
      });

      if (tenant._count.users >= tenant.plan.maxUsers) {
        throw new ForbiddenException(
          `Limite de usuarios do plano ${tenant.plan.name} atingido (${tenant.plan.maxUsers}).`,
        );
      }

      const existing = await tx.user.findUnique({ where: { email: dto.email } });
      if (existing) {
        throw new ConflictException('Ja existe uma conta com esse e-mail.');
      }

      return tx.user.create({
        data: {
          tenantId,
          name: dto.name,
          email: dto.email,
          role: dto.role,
          passwordHash,
          mustChangePassword: true,
        },
      });

    });

    const invitationEmailStatus = await this.sendInvitation(user, temporaryPassword);

    return {
      invitationEmailStatus,
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      temporaryPassword, // exibir uma unica vez para o admin repassar ao novo agente
    };
  }

  async limitsForTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId }, include: { plan: true, _count: { select: { users: true } } },
    });
    return { planName: tenant.plan.name, used: tenant._count.users, maxUsers: tenant.plan.maxUsers,
      available: Math.max(0, tenant.plan.maxUsers - tenant._count.users) };
  }

  async deleteOperator(tenantId: string, actorId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const target = await tx.user.findFirst({ where: { id, tenantId } });
      if (!target) throw new NotFoundException('Operador nao encontrado.');
      if (id === actorId || target.role !== 'AGENT') throw new ForbiddenException('Somente operadores podem ser excluidos. Administradores e seu proprio acesso sao preservados.');
      await tx.conversation.updateMany({ where: { assignedUserId: id, channel: { tenantId } }, data: { assignedUserId: null } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const settings = JSON.parse(JSON.stringify(tenant.workspaceSettings || {}));
      if (Array.isArray(settings.stages)) {
        settings.stages = settings.stages.map((stage: any) => {
          if (stage.userId === id) { const { userId, ...rest } = stage; return rest; }
          return stage;
        });
        await tx.tenant.update({ where: { id: tenantId }, data: { workspaceSettings: settings } });
      }
      // Password reset records cascade; resolver snapshots and audit history remain intact.
      await tx.user.delete({ where: { id } });
      await tx.auditEvent.create({ data: { tenantId, actorId, action: `user.deleted:${id}` } });
      return { deleted: true };
    });
  }

  private async sendInvitation(user: { name: string; email: string }, password: string): Promise<'accepted' | 'failed' | 'not_configured'> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    const origin = process.env.FRONTEND_URL;
    if (!apiKey || !from || !origin || !/^https:\/\/[^/?#]+\/?$/.test(origin)) return 'not_configured';
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [user.email], subject: 'Seu acesso ao Nodus',
          text: `Olá, ${user.name}!\n\nSeu acesso ao Nodus foi criado.\nAcesse: ${origin.replace(/\/$/, '')}\nE-mail: ${user.email}\nSenha temporária: ${password}\n\nVocê deverá trocar essa senha no primeiro acesso. Não compartilhe sua senha.\nSe precisar, use Esqueci minha senha na tela de login.` }),
      });
      if (!response.ok) throw new Error('Invitation rejected');
      return 'accepted';
    } catch {
      // Never log credentials, recipient, request body or provider response.
      this.logger.warn('Falha ao enviar convite de acesso. Usuario criado; repasse a senha temporaria por canal privado.');
      return 'failed';
    }
  }

}
