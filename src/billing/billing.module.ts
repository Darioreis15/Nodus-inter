import { BillingSandbox } from './billing-sandbox';
import { ConversationsModule } from '../conversations/conversations.module';
import { BillingDelivery } from './billing-delivery';
import { BillingActivation } from './billing-activation';
import { BillingRunController } from './billing-run.controller';
import { BillingCalendar } from './billing-calendar';
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { AsaasClient } from './asaas.client';

@Module({
  imports:[ConversationsModule],
  controllers: [BillingController, BillingRunController],
  providers: [BillingSandbox, BillingDelivery, BillingService, AsaasClient, BillingCalendar, BillingActivation],
  exports: [BillingSandbox, BillingDelivery, BillingService, BillingCalendar, BillingActivation],
})
export class BillingModule {}
