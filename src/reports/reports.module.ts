import { MetaCostsService } from './meta-costs.service';
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, MetaCostsService],
})
export class ReportsModule {}
