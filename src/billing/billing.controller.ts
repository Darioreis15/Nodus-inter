import { BadRequestException, Query, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { AllowSuspendedTenant } from '../common/decorators/allow-suspended-tenant.decorator';
import { SubscribeDto } from './dto/subscribe.dto';

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @AllowSuspendedTenant()
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.getStatus(user.tenantId);
  }

  @UseGuards(RolesGuard) @Roles('ADMIN') @AllowSuspendedTenant() @Get('payments')
  payments(@CurrentUser() user: AuthenticatedUser, @Query('offset') raw = '0') {
    const offset = Number(raw);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new BadRequestException('Paginacao invalida.');
    return this.billingService.payments(user.tenantId, offset);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribeDto) {
    return this.billingService.subscribe(user.tenantId, dto);
  }
}
