import { PrismaService } from '../prisma/prisma.service';
import { StartConversationDto, TemplateMessageDto } from '../conversations/dto/start-conversation.dto';
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CurrentApiTenant } from './decorators/current-api-tenant.decorator';
import { ConversationsService } from '../conversations/conversations.service';
import { PublicSendMessageDto } from './dto/send-message.dto';

@UseGuards(ApiKeyGuard)
@Controller('public/v1/conversations')
export class PublicConversationsController {
  constructor(private conversationsService: ConversationsService) {}

  @Post()
  start(@CurrentApiTenant() tenantId: string, @Body() dto: StartConversationDto) { return this.conversationsService.start(tenantId,dto); }

  @Post(':id/template')
  template(@CurrentApiTenant() tenantId: string, @Param('id') id: string, @Body() dto: TemplateMessageDto) { return this.conversationsService.sendTemplate(tenantId,id,dto); }

  @Get()
  list(
    @CurrentApiTenant() tenantId: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: 'OPEN' | 'PENDING' | 'RESOLVED',
  ) {
    return this.conversationsService.listForTenant(tenantId, { status, cursor });
  }

  @Get(':id/messages')
  listMessages(@CurrentApiTenant() tenantId: string, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.conversationsService.listMessages(tenantId, id, cursor);
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

@UseGuards(ApiKeyGuard)
@Controller('public/v1/channels')
export class PublicChannelsController {
  constructor(private prisma: PrismaService) {}
  @Get()
  list(@CurrentApiTenant() tenantId: string) {
    return this.prisma.channel.findMany({where:{tenantId},select:{id:true,name:true,type:true,status:true}});
  }
}
