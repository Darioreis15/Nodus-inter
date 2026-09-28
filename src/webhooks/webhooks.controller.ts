import { createHmac } from 'crypto';
import { secretMatches } from '../security/secrets';
import { Body, Controller, Get, Headers, HttpCode, Logger, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
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
  handleEvolution(@Param('channelId') channelId: string, @Body() payload: any, @Headers('x-evolution-token') token: string) {
    if (!secretMatches(token, process.env.EVOLUTION_WEBHOOK_TOKEN)) throw new UnauthorizedException();
    this.logger.log(`[Evolution] webhook recebido para o canal ${channelId}`);
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

    if (mode === 'subscribe' && secretMatches(token, process.env.META_VERIFY_TOKEN)) {
      this.logger.log('[Meta] verificacao OK, devolvendo challenge.');
      res.status(200).send(challenge);
      return;
    }
    this.logger.warn('[Meta] verificacao falhou -- token nao bateu com META_VERIFY_TOKEN.');
    res.status(403).send('Verificacao invalida.');
  }

  @Post('meta')
  handleMeta(@Body() payload: any, @Req() req: any) {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !Buffer.isBuffer(req.rawBody)) throw new UnauthorizedException();
    const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (!secretMatches(req.headers['x-hub-signature-256'], expected)) throw new UnauthorizedException();
    this.logger.log('[Meta] webhook de evento recebido');
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
    // Query legada nao e aceita: segredos nao devem transitar em URLs.
    const token = headerToken;
    if (!secretMatches(token, expectedToken)) {
      throw new UnauthorizedException('Token de webhook invalido.');
    }
    this.logger.log(`[Asaas] evento recebido: ${payload?.event}`);
    return this.billingService.handlePaymentEvent(payload?.event, payload);
  }
}
