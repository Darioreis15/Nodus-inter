import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { SubscribeDto } from './dto/subscribe.dto';

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.getStatus(user.tenantId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribeDto) {
    return this.billingService.subscribe(user.tenantId, dto);
  }
}
