import { evolutionContent, metaContent } from '../conversations/message-media';
import { MessageStatus } from '@prisma/client';
import { metaErrorInfo } from '../channels/connectors/meta-api';
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

    const event = String(payload?.event ?? '').toLowerCase().replace(/_/g, '.');
    this.logger.log(`[Evolution] evento identificado: "${event}" (canal ${channel.id})`);

    if (event === 'connection.update') {
      const state = payload?.data?.state;
      const status = state === 'open' ? 'CONNECTED' : state === 'close' ? 'DISCONNECTED' : channel.status;
      this.logger.log(`[Evolution] connection.update: state="${state}" -> status="${status}"`);
      await this.prisma.channel.update({ where: { id: channel.id }, data: { status } });
      return { ok: true };
    }

    if (event === 'messages.update') {
      for (const update of (Array.isArray(payload?.data) ? payload.data : [payload?.data])) {
        if (update?.key?.fromMe === false || update?.fromMe === false) continue;
        const value = update?.update?.status ?? update?.status;
        const mapped: Record<string, MessageStatus> = { '0':'FAILED','2':'SENT','3':'DELIVERED','4':'READ','5':'READ', ERROR:'FAILED',SERVER_ACK:'SENT',DELIVERY_ACK:'DELIVERED',READ:'READ',PLAYED:'READ' };
        await this.updateReceipt(channel.id, update?.keyId || update?.key?.id, mapped[String(value).toUpperCase()]);
      }
      return { ok: true };
    }

    if (event === 'messages.upsert') {
      const raw = payload?.data;
      const isGroup = String(raw?.key?.remoteJid ?? '').endsWith('@g.us');
      if (isGroup && (channel.config as any)?.receiveGroupMessages === false) return { ok: true };
      const fromMe = raw?.key?.fromMe;
      if (fromMe) {
        return { ok: true }; // eco da propria mensagem que a gente mandou, ignora
      }

      const { text, media } = evolutionContent(raw);
      const from = String(raw?.key?.remoteJid ?? '').split('@')[0];

      await this.conversations.recordInboundMessage(
        channel,
        from || 'desconhecido',
        text,
        raw?.key?.id,
        payload,
        raw?.key?.remoteJid?.endsWith('@g.us') ? undefined : raw?.pushName,
        ...(media ? [media] : []),
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
          const { text, media } = metaContent(message);
          await this.conversations.recordInboundMessage(
            channel,
            message.from,
            text,
            message.id,
            message,
            value?.contacts?.find((c: any) => c.wa_id === message.from)?.profile?.name,
            ...(media ? [media] : []),
          );
        }

        for (const status of value?.statuses ?? []) {
          this.logger.log(`[Meta] status update: mensagem ${status.id} -> ${status.status}`);
          if (status.status === 'failed') {
            for (const error of (Array.isArray(status.errors) ? status.errors.slice(0, 5) : [])) {
              const info = metaErrorInfo(error);
              this.logger.warn(`[Meta] falha de entrega: codigo=${info.code ?? 'desconhecido'} subcodigo=${info.subcode ?? '-'}; ${info.message}`);
            }
          }
          await this.updateReceipt(channel.id, status.id, this.mapMetaStatus(status.status));
        }
      }
    }

    return { ok: true };
  }

  private async updateReceipt(channelId: string, externalId: unknown, status?: MessageStatus) {
    if (!status || typeof externalId !== 'string' || !externalId || externalId.length > 512) return;
    const allowed: Partial<Record<MessageStatus, MessageStatus[]>> = { SENT:['QUEUED','SENT'], DELIVERED:['QUEUED','SENT','FAILED','DELIVERED'], READ:['QUEUED','SENT','FAILED','DELIVERED','READ'], FAILED:['QUEUED','SENT','FAILED'] };
    await this.prisma.message.updateMany({ where: { externalId, direction:'OUTBOUND', conversation:{channelId}, status:{in:allowed[status]} }, data:{status} });
  }

  private mapMetaStatus(status: string): MessageStatus | undefined {
    switch (status) {
      case 'delivered':
        return 'DELIVERED';
      case 'read':
        return 'READ';
      case 'failed':
        return 'FAILED';
      case 'sent': return 'SENT';
      default: return undefined;
    }
  }
}
