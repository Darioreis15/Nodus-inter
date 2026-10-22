import { MetaCostsService } from './meta-costs.service';
import { MetaCostsQuery, MetaAccountDto } from './meta-costs.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Controller, Get, UseGuards, Query, Param, Patch, Body, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService, private metaCosts: MetaCostsService) {}

  @Roles('ADMIN')
  @Get('meta-costs')
  costs(@CurrentUser() user: AuthenticatedUser, @Query() query: MetaCostsQuery) {
    return this.metaCosts.get(user.tenantId, query.channelId, query.month);
  }

  @Roles('ADMIN')
  @Patch('meta-costs/:channelId/account')
  configure(@CurrentUser() user: AuthenticatedUser, @Param('channelId', ParseUUIDPipe) channelId: string, @Body() dto: MetaAccountDto) {
    return this.metaCosts.configure(user.tenantId, channelId, dto.wabaId);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getSummary(user.tenantId);
  }
}
