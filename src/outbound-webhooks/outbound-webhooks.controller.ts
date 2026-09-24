import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('webhook-subscriptions')
export class OutboundWebhooksController {
  constructor(private service: OutboundWebhooksService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listForTenant(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWebhookSubscriptionDto) {
    return this.service.createForTenant(user.tenantId, dto);
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.revoke(user.tenantId, id);
  }
}
