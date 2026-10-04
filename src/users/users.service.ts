import { ConflictException, Injectable, ForbiddenException, Logger } from '@nestjs/common';
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

    const temporaryPassword = dto.temporaryPassword || crypto.randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

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
