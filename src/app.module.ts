import { PrivacyModule } from './privacy/privacy.controller';
import { Module } from '@nestjs/common';
import { RateGuard, SecurityModule } from './security/rate.guard';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { ChannelsModule } from './channels/channels.module';
import { ConversationsModule } from './conversations/conversations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { OutboundWebhooksModule } from './outbound-webhooks/outbound-webhooks.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PublicApiModule } from './public-api/public-api.module';
import { ReportsModule } from './reports/reports.module';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [
    PrismaModule,
    PrivacyModule,
    SecurityModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    ChannelsModule,
    ConversationsModule,
    WebhooksModule,
    OutboundWebhooksModule,
    ApiKeysModule,
    PublicApiModule,
    ReportsModule,
    BillingModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useExisting: RateGuard,
    },
  ],
})
export class AppModule {}
