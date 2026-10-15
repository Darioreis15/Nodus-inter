import { CreateOwnerContractDto } from '../billing/dto/create-owner-contract.dto';
import { ActivateContractDto, BillingActivation } from '../billing/billing-activation';
import { BillingCalendar } from '../billing/billing-calendar';
import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, CanActivate, ExecutionContext, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AllowSuspendedTenant } from '../common/decorators/allow-suspended-tenant.decorator';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { CancelSubscriptionDto } from '../billing/dto/cancel-subscription.dto';
import { RateGuard } from '../security/rate.guard';
import { assertPlatformOwner } from './owner-access';
class CompanyQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
  @IsOptional() @IsUUID() cursor?: string;
}
class PlanChange {
  @IsUUID() planId: string;
  @IsUUID() expectedPlanId: string;
  @IsString() @MinLength(1) @MaxLength(4096) currentPassword: string;
  @IsIn(['ACCESS_ONLY']) confirmation: string;
}
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(private rate: RateGuard) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    assertPlatformOwner(req.user);
    if (req.method !== 'GET') await this.rate.consume(`owner:mutation:${req.user.userId}`, 10, 900000);
    return true;
  }
}
@Injectable()
export class OwnerService {
  constructor(private prisma: PrismaService) {}
  async list(query: CompanyQuery) {
    const where = { ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [
      { name: { contains: query.search, mode: 'insensitive' as const } },
      { slug: { contains: query.search, mode: 'insensitive' as const } },
    ] } : {}), ...(query.cursor ? { id: { gt: query.cursor } } : {}) };
    const rows = await this.prisma.tenant.findMany({ where, orderBy: { id: 'asc' }, take: 26,
      select: { id: true, name: true, slug: true, status: true, createdAt: true,
        plan: { select: { id: true, name: true, priceCents: true, maxChannels: true, maxUsers: true } },
        subscription: { select: { status: true, cancellationPending: true, canceledAt: true, calendarEnabled: true, billingStartMonth: true, billingPriceCents: true, calendarError: true, billingCycles: { where: { error: { not: null } }, select: { month: true, error: true }, take: 5 } } },
        _count: { select: { users: true, channels: true } } } });
    return { data: rows.slice(0, 25), nextCursor: rows.length > 25 ? rows[24].id : null };
  }
  async changePlan(id: string, actorId: string, dto: PlanChange) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    assertPlatformOwner(actor || undefined);
    if (!actor || !await bcrypt.compare(dto.currentPassword, actor.passwordHash)) throw new ForbiddenException('Senha incorreta.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${id} FOR UPDATE`;
      const currentActor = await tx.user.findUnique({ where: { id: actorId } });
      assertPlatformOwner(currentActor || undefined);
      if (currentActor?.passwordHash !== actor.passwordHash || currentActor.tokenVersion !== actor.tokenVersion) throw new ForbiddenException('Entre novamente.');
      const tenant = await tx.tenant.findUnique({ where: { id }, include: { subscription: true, _count: { select: { users: true, channels: true } } } });
      if (!tenant) throw new NotFoundException('Empresa nao encontrada.');
      if (tenant.planId !== dto.expectedPlanId) throw new ConflictException('Plano alterado por outra operacao. Atualize a lista.');
      if (tenant.subscription?.status === 'CANCELED') throw new ConflictException('Contrato encerrado.');
      const plan = await tx.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new NotFoundException('Plano nao encontrado.');
      if (tenant._count.users > plan.maxUsers || tenant._count.channels > plan.maxChannels) throw new ConflictException('Uso atual excede os limites do plano escolhido.');
      await tx.tenant.update({ where: { id }, data: { planId: plan.id } });
      await tx.auditEvent.create({ data: { tenantId: id, actorId, action: `owner.plan_access_changed:${tenant.planId}:${plan.id}` } });
      return { ok: true, billingChanged: false, message: 'Plano de acesso atualizado. Cobrancas e recorrencia existentes permanecem iguais.' };
    });
  }
}
@Controller('owner')
@UseGuards(JwtAuthGuard, OwnerGuard)
export class OwnerController {
  constructor(private service: OwnerService, private prisma: PrismaService, private billing: BillingService, private calendar: BillingCalendar, private activation: BillingActivation) {}
  @Get('me') @AllowSuspendedTenant()
  me(@CurrentUser() user: AuthenticatedUser) { return { email: user.email, access: 'PLATFORM_OWNER' }; }
  @Get('summary') @AllowSuspendedTenant()
  async summary() {
    const [total, active, suspended, pendingCancellation] = await Promise.all([
      this.prisma.tenant.count(), this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.subscription.count({ where: { cancellationPending: true } }),
    ]);
    return { total, active, suspended, pendingCancellation };
  }
  @Get('billing-calendar') @AllowSuspendedTenant()
  async calendarStatus() {
    const [enabledContracts, migrationPending, emissionPending] = await Promise.all([
      this.prisma.subscription.count({ where: { calendarEnabled: true, status: { not: 'CANCELED' } } }),
      this.prisma.subscription.count({ where: { calendarEnabled: false, status: 'ACTIVE', tenant: { status: 'ACTIVE' } } }),
      this.prisma.billingCycle.count({ where: { state: 'SENDING' } }),
    ]);
    return { enabled: process.env.BILLING_CALENDAR_ENABLED === 'true', issueDay: 1, dueDay: 10, timezone: 'America/Sao_Paulo', enabledContracts, migrationPending, emissionPending };
  }
  @Get('plans') @AllowSuspendedTenant()
  plans() { return this.prisma.plan.findMany({ select: { id: true, name: true, priceCents: true, maxUsers: true, maxChannels: true }, orderBy: { priceCents: 'asc' } }); }
  @Get('tenants') @AllowSuspendedTenant()
  list(@Query() query: CompanyQuery) { return this.service.list(query); }
  @Patch('tenants/:id/plan') @AllowSuspendedTenant()
  plan(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: PlanChange) { return this.service.changePlan(id, user.userId, dto); }
  @Get('tenants/:id/contract-preview') @AllowSuspendedTenant()
  contractPreview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.activation.previewCreation(id, user.userId); }
  @Post('tenants/:id/contract') @AllowSuspendedTenant()
  createContract(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOwnerContractDto) { return this.activation.createContract(id, user.userId, dto); }
  @Post('tenants/:id/activate') @AllowSuspendedTenant()
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ActivateContractDto) { return this.activation.activate(id, user.userId, dto); }
  @Post('tenants/:id/cancel') @AllowSuspendedTenant()
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CancelSubscriptionDto) { return this.billing.cancelAsOwner(id, user.userId, dto); }
}
@Module({ imports: [BillingModule], controllers: [OwnerController], providers: [OwnerService, OwnerGuard] })
export class OwnerModule {}
