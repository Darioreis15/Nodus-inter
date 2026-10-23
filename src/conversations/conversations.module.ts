import { ConversationAccessGuard } from './conversation-access.guard';
import { PipelineWorker, PipelineRunController } from './pipeline-worker';
import { ConversationNotesController, ConversationNotesService } from './conversation-notes';
import { MessageMediaService } from './message-media.service';
import { AttachmentSendService } from './attachment-send.service';
import { AttachmentUploadGate } from './attachment-upload';
import { ContactPhotosService } from './contact-photos.service';
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { OutboundWebhooksModule } from '../outbound-webhooks/outbound-webhooks.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ContactsService } from './contacts.service';

@Module({
  imports: [ChannelsModule, OutboundWebhooksModule],
  controllers: [PipelineRunController, ConversationsController, ConversationNotesController],
  providers: [ConversationAccessGuard, PipelineWorker, ConversationNotesService, AttachmentUploadGate, AttachmentSendService, MessageMediaService, ConversationsService, ContactsService, ContactPhotosService],
  exports: [ConversationsService, AttachmentUploadGate, AttachmentSendService],
})
export class ConversationsModule {}
