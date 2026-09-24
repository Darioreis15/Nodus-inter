import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateAutoReplyDto } from './dto/update-auto-reply.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('channels')
export class ChannelsController {
  constructor(private channelsService: ChannelsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.channelsService.listForTenant(user.tenantId);
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateChannelDto) {
    const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    return this.channelsService.createForTenant(user.tenantId, appBaseUrl, dto);
  }

  @Roles('ADMIN')
  @Get(':id/qrcode')
  getQrCode(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.channelsService.getQrCode(user.tenantId, id);
  }

  @Roles('ADMIN')
  @Patch(':id/auto-reply')
  updateAutoReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAutoReplyDto,
  ) {
    return this.channelsService.updateAutoReply(user.tenantId, id, dto.enabled, dto.message);
  }

  @Roles('ADMIN')
  @Delete(':id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.channelsService.delete(user.tenantId, id);
  }
}
