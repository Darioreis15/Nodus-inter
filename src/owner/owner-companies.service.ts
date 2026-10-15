import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { assertPlatformOwner } from './owner-access';
import { CreateCompanyDto } from './create-company.dto';

@Injectable()
export class OwnerCompaniesService {
  constructor(private prisma: PrismaService, private users: UsersService) {}

  async create(actorId: string, dto: CreateCompanyDto) {
    if (dto.confirmation !== 'CREATE_COMPANY') throw new BadRequestException('Confirme com CREATE_COMPANY.');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    assertPlatformOwner(actor || undefined);
    if (!actor || !await bcrypt.compare(dto.currentPassword, actor.passwordHash)) throw new ForbiddenException('Senha incorreta.');
    const email = dto.adminEmail.trim().toLowerCase();
    const temporaryPassword = dto.temporaryPassword || randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    let company;
    try {
      company = await this.prisma.$transaction(async tx => {
        const currentActor = await tx.user.findUnique({ where: { id: actorId } });
        assertPlatformOwner(currentActor || undefined);
        if (currentActor?.passwordHash !== actor.passwordHash || currentActor.tokenVersion !== actor.tokenVersion) throw new ForbiddenException('Entre novamente.');
        if (await tx.user.findUnique({ where: { email } })) throw new ConflictException('Ja existe uma conta com esse e-mail. Use outro e-mail para o administrador principal.');
        const plan = await tx.plan.findUnique({ where: { id: dto.planId } });
        if (!plan) throw new NotFoundException('Plano nao encontrado. Atualize a lista de planos.');
        if (plan.maxUsers < 1) throw new ConflictException('O plano precisa permitir ao menos um usuario.');
        const base = dto.companyName.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'empresa';
        let slug = base;
        // Keep readable identifiers; suffix protects names shared by different companies.
        if (await tx.tenant.findUnique({ where: { slug } })) slug = `${base}-${randomBytes(6).toString('hex')}`;
        const tenant = await tx.tenant.create({ data: {
          name: dto.companyName.trim(), slug, planId: plan.id, status: 'ACTIVE',
          users: { create: { name: dto.adminName.trim(), email, passwordHash, role: 'ADMIN', isOwner: true, mustChangePassword: true } },
        }, select: { id: true, name: true, slug: true, status: true,
          plan: { select: { id: true, name: true, priceCents: true, maxUsers: true, maxChannels: true } },
          users: { select: { id: true, name: true, email: true, role: true, isOwner: true, mustChangePassword: true } } } });
        await tx.auditEvent.create({ data: { tenantId: tenant.id, actorId, action: `owner.company_created:${plan.id}` } });
        return tenant;
      }, { timeout: 10000, maxWait: 5000 });
    } catch (error) {
      // Database uniqueness also covers concurrent submissions / case-normalized emails.
      if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('E-mail ou identificador ja cadastrado. Atualize a lista antes de tentar novamente.');
      throw error;
    }
    const user = company.users[0];
    // Send only after commit. Email failure must never roll back a successfully created company.
    const invitationEmailStatus = dto.sendInvitation ? await this.users.sendInvitation(user, temporaryPassword) : 'not_requested';
    return { tenant: { id: company.id, name: company.name, slug: company.slug, status: company.status, plan: company.plan },
      user, temporaryPassword, invitationEmailStatus, contractCreated: false };
  }
}
