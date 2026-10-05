import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PublicConversationsController, PublicChannelsController } from './public-conversations.controller';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [ApiKeysModule, ConversationsModule],
  controllers: [PublicConversationsController, PublicChannelsController],
  providers: [ApiKeyGuard],
})
export class PublicApiModule {}
