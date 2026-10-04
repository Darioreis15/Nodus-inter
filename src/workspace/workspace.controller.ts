import { BadRequestException, Body, Controller, Get, Module, Param, Patch, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityDto, defaults, WorkspaceDto } from './workspace.dto';
@Controller('workspace')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkspaceController {
  constructor(private prisma: PrismaService) {}
  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    return { ...defaults, ...t.workspaceSettings as object };
  }
  @Patch() @Roles('ADMIN')
  async save(@CurrentUser() user: AuthenticatedUser, @Body() dto: WorkspaceDto) {
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: dto.timezone }).format(); } catch { throw new BadRequestException('Fuso horario invalido.'); }
    if (new Set(dto.stages.map(s => s.id)).size !== dto.stages.length) throw new BadRequestException('Etapas duplicadas.');
    const keywords = dto.stages.map(s => s.keyword.trim().toLowerCase()).filter(Boolean);
    if (new Set(keywords).size !== keywords.length) throw new BadRequestException('Use palavras-chave distintas.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${user.tenantId} FOR UPDATE`;
      const ids = [...new Set(dto.stages.map(s => s.userId).filter(Boolean))] as string[];
      const count = await tx.user.count({ where: { tenantId: user.tenantId, id: { in: ids } } });
      if (count !== ids.length) throw new BadRequestException('Operador de outra empresa ou inexistente.');
      await tx.tenant.update({ where: { id: user.tenantId }, data: { workspaceSettings: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue } });
      return dto;
    });
  }
  @Patch('users/:id/availability') @Roles('ADMIN')
  async availability(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AvailabilityDto) {
    const result = await this.prisma.user.updateMany({ where: { id, tenantId: user.tenantId }, data: { availability: JSON.parse(JSON.stringify(dto)) } });
    if (!result.count) throw new BadRequestException('Operador nao encontrado nesta empresa.');
    return { updated: true };
  }
}
@Module({ controllers: [WorkspaceController] })
export class WorkspaceModule {}
