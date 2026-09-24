import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private conversations: ConversationsService,
  ) {}

  /**
   * Evolution API manda o evento no formato { event, instance, data }.
   * Os dois que tratamos por enquanto: connection.update e messages.upsert.
   */
  async handleEvolutionEvent(channelId: string, payload: any) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new NotFoundException('Canal nao encontrado para esse webhook.');
    }

    const event = String(payload?.event ?? '').toLowerCase();
    this.logger.log(`[Evolution] evento identificado: "${event}" (canal ${channel.id})`);

    if (event === 'connection.update') {
      const state = payload?.data?.state;
      const status = state === 'open' ? 'CONNECTED' : state === 'close' ? 'DISCONNECTED' : channel.status;
      this.logger.log(`[Evolution] connection.update: state="${state}" -> status="${status}"`);
      await this.prisma.channel.update({ where: { id: channel.id }, data: { status } });
      return { ok: true };
    }

    if (event === 'messages.upsert') {
      const raw = payload?.data;
      const fromMe = raw?.key?.fromMe;
      if (fromMe) {
        return { ok: true }; // eco da propria mensagem que a gente mandou, ignora
      }

      const text = raw?.message?.conversation ?? raw?.message?.extendedTextMessage?.text ?? '';
      const from = String(raw?.key?.remoteJid ?? '').split('@')[0];
      this.logger.log(`[Evolution] mensagem recebida de ${from}: "${text}"`);

      await this.conversations.recordInboundMessage(
        channel,
        from || 'desconhecido',
        text,
        raw?.key?.id,
        payload,
      );
      return { ok: true };
    }

    this.logger.debug(`Evento Evolution nao tratado: ${event}`);
    return { ok: true };
  }

  /**
   * Meta manda um envelope { entry: [{ changes: [{ value: {...} }] }] }
   * com metadata.phone_number_id identificando o numero -- e assim que
   * achamos o canal certo, ja que o webhook e um so pra toda a conta.
   */
  async handleMetaEvent(payload: any) {
    const entries = payload?.entry ?? [];

    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const channel = await this.prisma.channel.findFirst({
          where: { type: 'OFFICIAL_META', externalId: phoneNumberId },
        });
        if (!channel) {
          this.logger.warn(`[Meta] Nenhum canal encontrado para phone_number_id ${phoneNumberId}`);
          continue;
        }
        this.logger.log(`[Meta] evento casado com o canal ${channel.id} (phone_number_id ${phoneNumberId})`);

        for (const message of value?.messages ?? []) {
          this.logger.log(`[Meta] mensagem recebida de ${message.from}: "${message.text?.body ?? ''}"`);
          await this.conversations.recordInboundMessage(
            channel,
            message.from,
            message.text?.body ?? '',
            message.id,
            message,
          );
        }

        for (const status of value?.statuses ?? []) {
          this.logger.log(`[Meta] status update: mensagem ${status.id} -> ${status.status}`);
          await this.prisma.message.updateMany({
            where: { externalId: status.id },
            data: { status: this.mapMetaStatus(status.status) },
          });
        }
      }
    }

    return { ok: true };
  }

  private mapMetaStatus(status: string): 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' {
    switch (status) {
      case 'delivered':
        return 'DELIVERED';
      case 'read':
        return 'READ';
      case 'failed':
        return 'FAILED';
      default:
        return 'SENT';
    }
  }
}
