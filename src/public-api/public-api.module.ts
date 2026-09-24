import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PublicConversationsController } from './public-conversations.controller';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [ApiKeysModule, ConversationsModule],
  controllers: [PublicConversationsController],
  providers: [ApiKeyGuard],
})
export class PublicApiModule {}
