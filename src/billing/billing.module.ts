import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { AsaasClient } from './asaas.client';

@Module({
  controllers: [BillingController],
  providers: [BillingService, AsaasClient],
  exports: [BillingService],
})
export class BillingModule {}
