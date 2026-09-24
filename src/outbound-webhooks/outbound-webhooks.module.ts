import { Module } from '@nestjs/common';
import { OutboundWebhooksController } from './outbound-webhooks.controller';
import { OutboundWebhooksService } from './outbound-webhooks.service';

@Module({
  controllers: [OutboundWebhooksController],
  providers: [OutboundWebhooksService],
  exports: [OutboundWebhooksService],
})
export class OutboundWebhooksModule {}
