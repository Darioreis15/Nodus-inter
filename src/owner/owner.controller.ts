import { nextMonth, saoPauloDate } from '../billing/billing-calendar';
import { BillingSandbox, SandboxBillingDto, SandboxWhatsappDto } from '../billing/billing-sandbox';
import { BillingDelivery, BillingDeliveryDto, DeliveryReviewDto } from '../billing/billing-delivery';
import { UsersModule } from '../users/users.module';
import { OwnerCompaniesService } from './owner-companies.service';
import { CreateCompanyDto } from './create-company.dto';
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
  @IsIn(['PLAN_AND_NEXT_MONTH']) confirmation: string;
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
        subscription: { select: { status: true, cancellationPending: true, canceledAt: true, calendarEnabled: true, billingStartMonth: true, billingPriceCents: true, billingOptions: true, calendarError: true, billingCycles: { where: { error: { not: null } }, select: { month: true, error: true }, take: 5 } } },
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
      if (dto.confirmation !== 'PLAN_AND_NEXT_MONTH') throw new ConflictException('Atualize o painel e confirme a alteracao da proxima mensalidade.');
      const sub = tenant.subscription;
      if (sub?.cancellationPending) throw new ConflictException('Conclua o cancelamento pendente.');
      if (sub && !sub.calendarEnabled) throw new ConflictException('Aguarde a migracao do contrato para o calendario Nodus antes de alterar o plano.');
      if (!Number.isSafeInteger(plan.priceCents) || plan.priceCents < 500) throw new ConflictException('Plano sem preco de cobranca valido.');
      const effectiveMonth = nextMonth(saoPauloDate().slice(0,7));
      if (sub) {
        const options = (sub.billingOptions || {}) as any;
        const schedule = Array.isArray(options.planPriceSchedule) ? options.planPriceSchedule : [];
        await tx.subscription.update({ where: { id: sub.id }, data: { billingOptions: {
          ...options, planPriceSchedule: [...schedule.filter((c:any)=>c.month!==effectiveMonth), { month:effectiveMonth, priceCents:plan.priceCents, planId:plan.id }],
        } } });
      }
      await tx.tenant.update({ where: { id }, data: { planId: plan.id } });
      await tx.auditEvent.create({ data: { tenantId: id, actorId, action: `owner.plan_changed:${tenant.planId}:${plan.id}:${effectiveMonth}:${plan.priceCents}` } });
      return { ok: true, billingChanged: !!sub, effectiveMonth: sub ? effectiveMonth : null, priceCents: plan.priceCents, message: sub ? `Plano atualizado. Novo valor nas mensalidades a partir de ${effectiveMonth}; cobrancas ja emitidas permanecem iguais.` : 'Plano atualizado. O valor sera usado quando o contrato for criado.' };
    });
  }
}
@Controller('owner')
@UseGuards(JwtAuthGuard, OwnerGuard)
export class OwnerController {
  constructor(private service: OwnerService, private prisma: PrismaService, private billing: BillingService, private calendar: BillingCalendar, private activation: BillingActivation, private companies: OwnerCompaniesService, private delivery: BillingDelivery, private sandbox: BillingSandbox) {}
  @Post('tenants/:id/sandbox-whatsapp') @AllowSuspendedTenant()
  sandboxWhatsapp(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: SandboxWhatsappDto) { return this.sandbox.whatsapp(id, user.userId, dto); }
  @Post('tenants/:id/sandbox-billing') @AllowSuspendedTenant()
  sandboxBilling(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: SandboxBillingDto) { return this.sandbox.issue(id, user.userId, dto); }
  @Get('tenants/:id/delivery') @AllowSuspendedTenant()
  deliveryConfig(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.delivery.config(id, user.userId); }
  @Patch('tenants/:id/delivery') @AllowSuspendedTenant()
  deliverySave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: BillingDeliveryDto) { return this.delivery.save(id, user.userId, dto); }
  @Post('deliveries/:id/review') @AllowSuspendedTenant()
  deliveryReview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: DeliveryReviewDto) { return this.delivery.review(id, user.userId, dto); }
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
      this.prisma.billingCycle.count({ where: { state: 'SENDING', isTest: false } }),
    ]);
    return { enabled: process.env.BILLING_CALENDAR_ENABLED === 'true', issueDay: 1, dueDay: 10, timezone: 'America/Sao_Paulo', enabledContracts, migrationPending, emissionPending };
  }
  @Get('plans') @AllowSuspendedTenant()
  plans() { return this.prisma.plan.findMany({ select: { id: true, name: true, priceCents: true, maxUsers: true, maxChannels: true }, orderBy: { priceCents: 'asc' } }); }
  @Post('tenants') @AllowSuspendedTenant()
  createCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanyDto) { return this.companies.create(user.userId, dto); }
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
@Module({ imports: [BillingModule, UsersModule], controllers: [OwnerController], providers: [OwnerService, OwnerGuard, OwnerCompaniesService] })
export class OwnerModule {}
