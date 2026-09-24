import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CurrentApiTenant } from './decorators/current-api-tenant.decorator';
import { ConversationsService } from '../conversations/conversations.service';
import { PublicSendMessageDto } from './dto/send-message.dto';

@UseGuards(ApiKeyGuard)
@Controller('public/v1/conversations')
export class PublicConversationsController {
  constructor(private conversationsService: ConversationsService) {}

  @Get()
  list(
    @CurrentApiTenant() tenantId: string,
    @Query('status') status?: 'OPEN' | 'PENDING' | 'RESOLVED',
  ) {
    return this.conversationsService.listForTenant(tenantId, { status });
  }

  @Get(':id/messages')
  listMessages(@CurrentApiTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.listMessages(tenantId, id);
  }

  @Post(':id/messages')
  sendMessage(
    @CurrentApiTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: PublicSendMessageDto,
  ) {
    return this.conversationsService.sendMessage(tenantId, id, dto.text);
  }
}
