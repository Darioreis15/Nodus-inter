import { Body, Controller, Delete, ForbiddenException, ConflictException, Get, Module, Param, Post, Query, UseGuards, NotFoundException, SetMetadata } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AllowSuspendedTenant } from '../common/decorators/allow-suspended-tenant.decorator';

class EraseDto {
  @IsString() @MinLength(1) @MaxLength(256) currentPassword: string;
  @IsIn(['ERASE']) confirmation: string;
}
@Controller('privacy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class PrivacyController {
  constructor(private prisma: PrismaService) {}
  private async reauthenticate(user: AuthenticatedUser, dto: EraseDto) {
    const actor = await this.prisma.user.findFirst({ where: { id: user.userId, tenantId: user.tenantId } });
    if (!actor || !await bcrypt.compare(dto.currentPassword, actor.passwordHash)) throw new ForbiddenException('Confirmacao de identidade invalida.');
  }
  @AllowSuspendedTenant()
  @Get('contacts/:id')
  async exportContact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('cursor') cursor?: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!contact) throw new NotFoundException();
    const messages = await this.prisma.message.findMany({
      where: { conversation: { contactId: id, channel: { tenantId: user.tenantId } }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 100,
      select: { id: true, body: true, createdAt: true, direction: true, status: true },
    });
    await this.prisma.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.userId, action: 'privacy.contact.export' } });
    return { contact: { id: contact.id, name: contact.name, waId: contact.waId }, messages, nextCursor: messages.length === 100 ? messages[99].id : null };
  }
  @AllowSuspendedTenant()
  @Delete('contacts/:id')
  async eraseContact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EraseDto) {
    await this.reauthenticate(user, dto);
    await this.prisma.$transaction(async tx => {
      const contact = await tx.contact.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!contact) throw new NotFoundException();
      if (contact.legalHold) throw new ConflictException('Retencao legal ativa: encaminhe a solicitacao ao responsavel.');
      await tx.conversation.deleteMany({ where: { contactId: id, channel: { tenantId: user.tenantId } } });
      await tx.contact.delete({ where: { id } });
      await tx.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.userId, action: 'privacy.contact.erase' } });
    });
    return { deleted: true, scope: 'local_contact_and_messages', externalCopiesRequireSeparateRequest: true };
  }
  @AllowSuspendedTenant()
  @Delete('users/:id')
  async eraseUser(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EraseDto) {
    await this.reauthenticate(user, dto);
    if (id === user.userId) throw new ForbiddenException('Outro administrador deve processar a exclusao da sua conta.');
    await this.prisma.$transaction(async tx => {
      const target = await tx.user.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!target) throw new NotFoundException();
      await tx.conversation.updateMany({ where: { assignedUserId: id, channel: { tenantId: user.tenantId } }, data: { assignedUserId: null } });
      await tx.user.delete({ where: { id } });
      await tx.auditEvent.updateMany({ where: { actorId: id }, data: { actorId: null } });
      await tx.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.userId, action: 'privacy.user.erase' } });
    });
    return { deleted: true };
  }
}
@Module({ controllers: [PrivacyController] })
export class PrivacyModule {}
