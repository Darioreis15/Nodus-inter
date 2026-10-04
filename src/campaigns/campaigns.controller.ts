import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, Req, Module } from '@nestjs/common';
import { createHash } from 'crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ApiKeyGuard } from '../public-api/guards/api-key.guard';
import { CurrentApiTenant } from '../public-api/decorators/current-api-tenant.decorator';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { CampaignDto, CampaignStateDto } from './campaigns.dto';
import { CampaignsService } from './campaigns.service';
@Controller('campaigns') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')
export class CampaignsController {
  constructor(private service: CampaignsService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.service.list(user.tenantId); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CampaignDto) { return this.service.create(user.tenantId,dto); }
  @Get(':id') detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('cursor') cursor?: string) { return this.service.detail(user.tenantId,id,cursor); }
  @Patch(':id') state(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CampaignStateDto) { return this.service.state(user.tenantId,id,dto.state); }
}
@Controller('public/v1/campaigns') @UseGuards(ApiKeyGuard)
export class PublicCampaignsController {
  constructor(private service: CampaignsService) {}
  @Get() list(@CurrentApiTenant() tenantId: string) { return this.service.list(tenantId); }
  @Post() create(@CurrentApiTenant() tenantId: string, @Body() dto: CampaignDto, @Req() request: any) {
    const hash = createHash('sha256').update(request.headers.authorization.slice(7).trim()).digest('hex');
    return this.service.create(tenantId,dto,hash);
  }
  @Get(':id') detail(@CurrentApiTenant() tenantId: string, @Param('id') id: string, @Query('cursor') cursor?: string) { return this.service.detail(tenantId,id,cursor); }
  @Patch(':id') state(@CurrentApiTenant() tenantId: string, @Param('id') id: string, @Body() dto: CampaignStateDto) { return this.service.state(tenantId,id,dto.state); }
}
@Module({ imports:[ConversationsModule,ApiKeysModule],controllers:[CampaignsController,PublicCampaignsController],providers:[CampaignsService,ApiKeyGuard] })
export class CampaignsModule {}
