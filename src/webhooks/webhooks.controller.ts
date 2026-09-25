import { Body, Controller, Get, Headers, HttpCode, Logger, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { WebhooksService } from './webhooks.service';
import { BillingService } from '../billing/billing.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private webhooksService: WebhooksService,
    private billingService: BillingService,
  ) {}

  @Post('evolution/:channelId')
  handleEvolution(@Param('channelId') channelId: string, @Body() payload: any) {
    this.logger.log(`[Evolution] webhook recebido para o canal ${channelId}`);
    this.logger.log(JSON.stringify(payload, null, 2));
    return this.webhooksService.handleEvolutionEvent(channelId, payload);
  }

  /**
   * Meta chama esse GET uma vez, na hora em que voce configura o
   * webhook no painel do app -- precisa devolver exatamente o
   * hub.challenge, como texto puro, se o verify_token bater.
   */
  @Get('meta')
  verifyMeta(@Query() query: Record<string, string>, @Res() res: Response) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    this.logger.log(
      `[Meta] verificacao recebida: mode=${mode} token=${token ? '(presente)' : '(ausente)'}`,
    );

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      this.logger.log('[Meta] verificacao OK, devolvendo challenge.');
      res.status(200).send(challenge);
      return;
    }
    this.logger.warn('[Meta] verificacao falhou -- token nao bateu com META_VERIFY_TOKEN.');
    res.status(403).send('Verificacao invalida.');
  }

  @Post('meta')
  handleMeta(@Body() payload: any) {
    this.logger.log('[Meta] webhook de evento recebido');
    this.logger.log(JSON.stringify(payload, null, 2));
    return this.webhooksService.handleMetaEvent(payload);
  }

  /** O Asaas envia o token configurado no header asaas-access-token. */
  @Post('asaas')
  @HttpCode(200)
  handleAsaas(
    @Headers('asaas-access-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Body() payload: any,
  ) {
    const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
    // Compatibilidade temporaria: o header sempre tem precedencia sobre a URL.
    const token = headerToken ?? queryToken;
    if (!expectedToken?.trim() || token !== expectedToken) {
      throw new UnauthorizedException('Token de webhook invalido.');
    }
    this.logger.log(`[Asaas] evento recebido: ${payload?.event}`);
    return this.billingService.handlePaymentEvent(payload?.event, payload);
  }
}
