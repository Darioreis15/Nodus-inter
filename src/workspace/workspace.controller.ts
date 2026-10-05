import { BadRequestException, Body, Controller, Get, Module, Param, Patch, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityDto, defaults, WorkspaceDto, DepartmentDto } from './workspace.dto';
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
    if (dto.stages.some(s => s.waitForReply && (!s.message.trim() || !s.completionMessage?.trim() || !s.departmentId))) throw new BadRequestException('Informe pergunta, mensagem de confirmacao e setor para aguardar resposta livre.');
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: dto.timezone }).format(); } catch { throw new BadRequestException('Fuso horario invalido.'); }
    if (new Set(dto.stages.map(s => s.id)).size !== dto.stages.length) throw new BadRequestException('Etapas duplicadas.');
    const keywords = dto.stages.filter(s => s.keyword.trim()).map(s => `${s.fromStageId || '*'}:${s.keyword.trim().toLowerCase()}`);
    if (new Set(keywords).size !== keywords.length) throw new BadRequestException('Use palavras-chave distintas.');
    if (dto.stages.some(s => s.fromStageId && (!dto.stages.some(t => t.id === s.fromStageId) || s.fromStageId === s.id))) throw new BadRequestException('Etapa de origem invalida.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${user.tenantId} FOR UPDATE`;
      const previous = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      const saved = previous.workspaceSettings as any;
      // Older clients omitting these fields must not delete existing departments.
      const departments: DepartmentDto[] = dto.departments ?? saved.departments ?? [];
      const awayDepartmentId = dto.awayDepartmentId === undefined ? saved.awayDepartmentId ?? null : dto.awayDepartmentId;
      const departmentIds = departments.map(d => d.id);
      const names = departments.map(d => d.name.trim().toLowerCase());
      if (new Set(departmentIds).size !== departmentIds.length || new Set(names).size !== names.length || names.some(n => !n)) throw new BadRequestException('Use nomes e identificadores de setores distintos.');
      if ([awayDepartmentId, ...dto.stages.map(s => s.departmentId)].filter(Boolean).some(id => !departmentIds.includes(id))) throw new BadRequestException('Setor inexistente nesta empresa.');
      const removed = (saved.departments || []).map((d: DepartmentDto) => d.id).filter((id: string) => !departmentIds.includes(id));
      if (removed.length) {
        await tx.conversation.updateMany({ where: { channel: { tenantId: user.tenantId }, departmentId: { in: removed } }, data: { departmentId: null } });
        await tx.channel.updateMany({ where: { tenantId: user.tenantId, autoReplyDepartmentId: { in: removed } }, data: { autoReplyDepartmentId: null } });
      }
      const result = { ...dto, departments, awayDepartmentId };
      const ids = [...new Set(dto.stages.map(s => s.userId).filter(Boolean))] as string[];
      const count = await tx.user.count({ where: { tenantId: user.tenantId, id: { in: ids } } });
      if (count !== ids.length) throw new BadRequestException('Operador de outra empresa ou inexistente.');
      await tx.tenant.update({ where: { id: user.tenantId }, data: { workspaceSettings: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } });
      return result;
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
