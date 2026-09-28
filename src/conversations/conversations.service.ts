import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from './contacts.service';
import { EvolutionConnector } from '../channels/connectors/evolution.connector';
import { MetaConnector } from '../channels/connectors/meta.connector';
import { ChannelConnector } from '../channels/connectors/channel-connector.interface';
import { ConversationRecord } from './conversation.types';
import { OutboundWebhooksService } from '../outbound-webhooks/outbound-webhooks.service';

interface ListFilters {
  cursor?: string;
  status?: 'OPEN' | 'PENDING' | 'RESOLVED';
  assignedUserId?: string;
}

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private contacts: ContactsService,
    private evolutionConnector: EvolutionConnector,
    private metaConnector: MetaConnector,
    private outboundWebhooks: OutboundWebhooksService,
  ) {}

  private connectorFor(channelType: 'QR_EVOLUTION' | 'OFFICIAL_META'): ChannelConnector {
    return channelType === 'QR_EVOLUTION' ? this.evolutionConnector : this.metaConnector;
  }

  /**
   * Usado pelo WebhooksService quando chega mensagem nova: acha (ou cria) o
   * contato e reaproveita uma conversa ainda aberta/pendente com ele nesse
   * canal -- ou abre uma nova se a ultima ja estava resolvida.
   */
  async recordInboundMessage(
    channel: {
      id: string;
      tenantId: string;
      externalId: string | null;
      type: 'QR_EVOLUTION' | 'OFFICIAL_META';
      autoReplyEnabled: boolean;
      autoReplyMessage: string | null;
    },
    fromNumber: string,
    text: string,
    externalId: string | undefined,
    raw: unknown,
  ) {
    const saved = await this.prisma.$transaction(async tx => {
      // Serializa a recepcao por canal para deduplicar mensagens concorrentes.
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channel.id} FOR UPDATE`;
      if (externalId) {
        const duplicate = await tx.message.findFirst({ where: { externalId, conversation: { channelId: channel.id } } });
        if (duplicate) return { duplicate: true as const, conversation: await tx.conversation.findUniqueOrThrow({ where: { id: duplicate.conversationId } }) };
      }
      const contact = await tx.contact.upsert({
        where: { tenantId_waId: { tenantId: channel.tenantId, waId: fromNumber } },
        create: { tenantId: channel.tenantId, waId: fromNumber }, update: {},
      });
      let conversation = await tx.conversation.findFirst({
        where: { channelId: channel.id, contactId: contact.id, status: { in: ['OPEN', 'PENDING'] } },
        orderBy: { updatedAt: 'desc' },
      });
      const isNewConversation = !conversation;
      if (!conversation) conversation = await tx.conversation.create({ data: { channelId: channel.id, contactId: contact.id, status: 'OPEN' } });
      else if (conversation.status === 'PENDING') conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { status: 'OPEN' } });
      const message = await tx.message.create({ data: {
        conversationId: conversation.id, direction: 'INBOUND', externalId,
        fromNumber, toNumber: channel.externalId ?? 'desconhecido', body: text, status: 'RECEIVED',
      } });
      return { duplicate: false as const, conversation, contact, message, isNewConversation };
    });
    if (saved.duplicate) return saved.conversation;
    const { conversation, contact, message, isNewConversation } = saved;

    // Nao espera a entrega do webhook -- um destino de terceiro fora do ar
    // nunca pode atrasar ou quebrar o recebimento da mensagem em si.
    this.outboundWebhooks
      .dispatch(channel.tenantId, 'message.received', {
        conversationId: conversation.id,
        contactId: contact.id,
        from: fromNumber,
        text,
        messageId: message.id,
      })
      .catch(() => {});

    if (isNewConversation && channel.autoReplyEnabled && channel.autoReplyMessage) {
      await this.sendAutoReply(channel, conversation.id, contact.waId, channel.autoReplyMessage);
    }

    return conversation;
  }

  private async sendAutoReply(
    channel: { type: 'QR_EVOLUTION' | 'OFFICIAL_META'; externalId: string | null },
    conversationId: string,
    to: string,
    text: string,
  ) {
    try {
      const connector = this.connectorFor(channel.type);
      const result = await connector.sendText(channel as any, { to, text });
      await this.prisma.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          externalId: result.externalId,
          fromNumber: channel.externalId ?? 'desconhecido',
          toNumber: to,
          body: text,
          status: 'SENT',
        },
      });
    } catch {
      // resposta automatica e um bonus -- se falhar, a conversa segue normal
      // e o agente responde manualmente.
    }
  }

  async listForTenant(tenantId: string, filters: ListFilters) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        channel: { tenantId },
        ...(filters.cursor ? { id: { gt: filters.cursor } } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
      },
      include: {
        contact: true,
        channel: { select: { id: true, name: true, type: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, direction: true, body: true, status: true, createdAt: true, fromNumber: true, toNumber: true } },
      },
      orderBy: { id: 'asc' },
      take: 100,
    });

    return conversations.map((c: (typeof conversations)[number]) => ({
      id: c.id,
      status: c.status,
      assignedUserId: c.assignedUserId,
      contact: { id: c.contact.id, waId: c.contact.waId, name: c.contact.name },
      channel: c.channel,
      lastMessage: c.messages[0] ?? null,
      updatedAt: c.updatedAt,
    }));
  }

  async findOwnedConversation(tenantId: string, conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, channel: { tenantId } },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa nao encontrada.');
    }
    return conversation;
  }

  async assign(tenantId: string, conversationId: string, userId: string) {
    await this.findOwnedConversation(tenantId, conversationId);

    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) {
      throw new ForbiddenException('Esse usuario nao pertence a esse tenant.');
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedUserId: userId },
    });

    this.outboundWebhooks
      .dispatch(tenantId, 'conversation.assigned', {
        conversationId,
        assignedUserId: userId,
      })
      .catch(() => {});

    return updated;
  }

  async updateStatus(tenantId: string, conversationId: string, status: 'OPEN' | 'PENDING' | 'RESOLVED') {
    await this.findOwnedConversation(tenantId, conversationId);
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { status } });
  }

  async listMessages(tenantId: string, conversationId: string, cursor?: string) {
    await this.findOwnedConversation(tenantId, conversationId);
    return this.prisma.message.findMany({
      where: { conversationId, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, direction: true, body: true, status: true, createdAt: true, fromNumber: true, toNumber: true },
    });
  }

  async sendMessage(tenantId: string, conversationId: string, text: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, channel: { tenantId } },
      include: { channel: true, contact: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa nao encontrada.');
    }

    const connector = this.connectorFor(conversation.channel.type as 'QR_EVOLUTION' | 'OFFICIAL_META');
    const result = await connector.sendText(conversation.channel as any, {
      to: conversation.contact.waId,
      text,
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        externalId: result.externalId,
        fromNumber: conversation.channel.externalId ?? 'desconhecido',
        toNumber: conversation.contact.waId,
        body: text,
        status: 'SENT',
      },
    });

    // Toda resposta do agente joga a conversa pra "aguardando o cliente"
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'PENDING' },
    });

    return message;
  }
}
