import { BillingActivation } from './billing-activation';
import { BillingRunController } from './billing-run.controller';
import { BillingCalendar } from './billing-calendar';
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { AsaasClient } from './asaas.client';

@Module({
  controllers: [BillingController, BillingRunController],
  providers: [BillingService, AsaasClient, BillingCalendar, BillingActivation],
  exports: [BillingService, BillingCalendar, BillingActivation],
})
export class BillingModule {}
