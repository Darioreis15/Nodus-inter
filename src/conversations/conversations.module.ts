import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { OutboundWebhooksModule } from '../outbound-webhooks/outbound-webhooks.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ContactsService } from './contacts.service';

@Module({
  imports: [ChannelsModule, OutboundWebhooksModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ContactsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
