import { StartConversationDto, ContactNameDto, StageDto, TemplateMessageDto } from './dto/start-conversation.dto';
import { Delete, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { UpdateConversationStatusDto } from './dto/update-status.dto';
import { SendConversationMessageDto } from './dto/send-message.dto';

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private conversationsService: ConversationsService) {}

  @Post()
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartConversationDto) {
    return this.conversationsService.start(user.tenantId, dto);
  }
  @Post(':id/template')
  template(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: TemplateMessageDto) {
    return this.conversationsService.sendTemplate(user.tenantId, id, dto);
  }
  @Patch(':id/contact')
  rename(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ContactNameDto) {
    return this.conversationsService.renameContact(user.tenantId, id, dto.name);
  }
  @Patch(':id/stage')
  stage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: StageDto) {
    return this.conversationsService.setStage(user.tenantId, id, dto.stageId);
  }
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversationsService.remove(user.tenantId, id, user.userId);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('status') status?: 'OPEN' | 'PENDING' | 'RESOLVED',
    @Query('mine') mine?: string,
  ) {
    return this.conversationsService.listForTenant(user.tenantId, {
      status, cursor,
      assignedUserId: mine === 'true' ? user.userId : undefined,
    });
  }

  @Get(':id/messages')
  listMessages(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.conversationsService.listMessages(user.tenantId, id, cursor);
  }

  @Post(':id/messages')
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendConversationMessageDto,
  ) {
    return this.conversationsService.sendMessage(user.tenantId, id, dto.text);
  }

  @Patch(':id/assign')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignConversationDto,
  ) {
    return this.conversationsService.assign(user.tenantId, id, dto.userId ?? user.userId);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationStatusDto,
  ) {
    return this.conversationsService.updateStatus(user.tenantId, id, dto.status, user.userId);
  }
}
