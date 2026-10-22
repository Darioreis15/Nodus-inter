import { NodusResponseInterceptor } from './nodus-response';
import { DeliveryController, DeliveryRunController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryWorker } from './delivery.worker';
import { DeliveryInput } from './delivery-input';
import { PublicTemplatesService } from './public-templates.service';
import { PublicAttachmentsController, PublicAttachmentsService } from './public-attachments';
import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PublicConversationsController, PublicChannelsController } from './public-conversations.controller';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [ApiKeysModule, ConversationsModule],
  controllers: [DeliveryController, DeliveryRunController, PublicAttachmentsController, PublicConversationsController, PublicChannelsController],
  providers: [NodusResponseInterceptor, DeliveryService, DeliveryWorker, DeliveryInput, PublicTemplatesService, PublicAttachmentsService, ApiKeyGuard],
})
export class PublicApiModule {}
