import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { EvolutionConnector } from './connectors/evolution.connector';
import { MetaConnector } from './connectors/meta.connector';

@Module({
  controllers: [ChannelsController],
  providers: [ChannelsService, EvolutionConnector, MetaConnector],
  exports: [EvolutionConnector, MetaConnector],
})
export class ChannelsModule {}
