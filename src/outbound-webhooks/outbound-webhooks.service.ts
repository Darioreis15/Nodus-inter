import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookSubscriptionDto, WebhookEvent } from './dto/create-webhook-subscription.dto';

@Injectable()
export class OutboundWebhooksService {
  private readonly logger = new Logger(OutboundWebhooksService.name);

  constructor(private prisma: PrismaService) {}

  async createForTenant(tenantId: string, dto: CreateWebhookSubscriptionDto) {
    const secret = crypto.randomBytes(24).toString('hex');
    const subscription = await this.prisma.webhookSubscription.create({
      data: { tenantId, url: dto.url, events: dto.events, secret },
    });
    // o secret so aparece aqui, na criacao -- depois disso nunca mais e devolvido
    return { ...subscription, secret };
  }

  async listForTenant(tenantId: string) {
    const subs = await this.prisma.webhookSubscription.findMany({ where: { tenantId } });
    return subs.map((s: (typeof subs)[number]) => ({
      id: s.id,
      url: s.url,
      events: s.events,
      active: s.active,
      createdAt: s.createdAt,
    }));
  }

  async revoke(tenantId: string, id: string) {
    const sub = await this.prisma.webhookSubscription.findFirst({ where: { id, tenantId } });
    if (!sub) {
      throw new NotFoundException('Assinatura de webhook nao encontrada.');
    }
    return this.prisma.webhookSubscription.update({ where: { id }, data: { active: false } });
  }

  /**
   * Dispara o evento pra todo mundo que assinou -- nunca deixa uma falha de
   * entrega derrubar quem chamou (webhook do cliente fora do ar nao pode
   * quebrar o fluxo principal de mensagens).
   */
  async dispatch(tenantId: string, event: WebhookEvent, payload: Record<string, unknown>) {
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { tenantId, active: true },
    });

    const targets = subs.filter((s: (typeof subs)[number]) =>
      (s.events as string[]).includes(event),
    );

    await Promise.all(
      targets.map((sub: (typeof subs)[number]) => this.deliver(sub, event, payload)),
    );
  }

  private async deliver(
    sub: { id: string; url: string; secret: string },
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ) {
    const body = JSON.stringify({ event, data: payload });
    const signature = crypto.createHmac('sha256', sub.secret).update(body).digest('hex');

    try {
      const response = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nodus-Event': event,
          'X-Nodus-Signature': signature,
        },
        body,
      });
      this.logger.log(`Webhook ${event} -> ${sub.url}: HTTP ${response.status}`);
    } catch (error) {
      this.logger.warn(`Falha ao entregar webhook ${event} -> ${sub.url}: ${error}`);
    }
  }
}
