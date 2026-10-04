import { createHash } from 'crypto';
import { defaults, withinHours, WorkspaceDto, AvailabilityDto } from '../workspace/workspace.dto';
import { StartConversationDto, TemplateMessageDto } from './dto/start-conversation.dto';
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
  departmentId?: string;
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
      autoReplyDepartmentId?: string | null;
    },
    fromNumber: string,
    text: string,
    externalId: string | undefined,
    raw: unknown,
    contactName?: string,
  ) {
    contactName = typeof contactName === 'string' ? contactName.trim().slice(0, 120) : undefined;
    const saved = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${channel.tenantId} FOR UPDATE`;
      // Serializa a recepcao por canal para deduplicar mensagens concorrentes.
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channel.id} FOR UPDATE`;
      if (externalId) {
        const duplicate = await tx.message.findFirst({ where: { externalId, conversation: { channelId: channel.id } } });
        if (duplicate) return { duplicate: true as const, conversation: await tx.conversation.findUniqueOrThrow({ where: { id: duplicate.conversationId } }) };
      }
      const contact = await tx.contact.upsert({
        where: { tenantId_waId: { tenantId: channel.tenantId, waId: fromNumber } },
        create: { tenantId: channel.tenantId, waId: fromNumber, name: contactName?.slice(0, 120) || null }, update: {},
      });
      if (!contact.name && contactName) await tx.contact.updateMany({ where: { id: contact.id, name: null }, data: { name: contactName } });
      let conversation = await tx.conversation.findFirst({
        where: { channelId: channel.id, contactId: contact.id, status: { in: ['OPEN', 'PENDING'] } },
        orderBy: { updatedAt: 'desc' },
      });
      const isNewConversation = !conversation;
      if (!conversation) conversation = await tx.conversation.create({ data: { channelId: channel.id, contactId: contact.id, status: 'OPEN' } });
      else conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { status: 'OPEN', updatedAt: new Date() } });
      const message = await tx.message.create({ data: {
        conversationId: conversation.id, direction: 'INBOUND', externalId,
        fromNumber, toNumber: channel.externalId ?? 'desconhecido', body: text, status: 'RECEIVED',
      } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: channel.tenantId } });
      const optOut = ['sair','parar','stop','cancelar'].includes(text.trim().toLowerCase());
      if (optOut) {
        const phoneHash = createHash('sha256').update(`${channel.tenantId}:${fromNumber}`).digest('hex');
        await tx.campaignSuppression.upsert({where:{tenantId_phoneHash:{tenantId:channel.tenantId,phoneHash}},create:{tenantId:channel.tenantId,phoneHash},update:{}});
      }
      await tx.campaignDelivery.updateMany({where:{contactId:contact.id,status:'QUEUED',campaign:{tenantId:channel.tenantId,...(optOut ? {} : {channelId:channel.id,stopOnReply:true})}},data:{status:'SKIPPED',payload:{},error:optOut ? 'Destinatario optou por sair.' : 'Cliente respondeu.',finishedAt:new Date()}});
      const settings = { ...defaults, ...tenant.workspaceSettings as object } as WorkspaceDto;
      const open = withinHours(settings.businessHours, settings.timezone);
      const candidates = settings.stages.filter(s => s.keyword.trim() && s.keyword.trim().toLowerCase() === text.trim().toLowerCase());
      const stage = candidates.find(s => s.fromStageId && s.fromStageId === conversation!.funnelStage) || candidates.find(s => !s.fromStageId);
      let reply: string | null = null;
      let departmentId: string | null | undefined;
      if (!open) {
        if (isNewConversation) { reply = settings.awayMessage || null; if (reply) departmentId = settings.awayDepartmentId; }
      } else if (stage && conversation.funnelStage !== stage.id) {
        let assignedUserId: string | null = null;
        if (stage.userId) {
          const operator = await tx.user.findFirst({ where: { id: stage.userId, tenantId: channel.tenantId } });
          const availability = operator?.availability as unknown as AvailabilityDto;
          if (operator && availability?.available !== false && withinHours(availability, settings.timezone)) assignedUserId = operator.id;
        }
        conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { funnelStage: stage.id, assignedUserId } });
        reply = stage.message || null;
        departmentId = stage.departmentId ?? null;
      } else if (isNewConversation && channel.autoReplyEnabled) {
        reply = channel.autoReplyMessage;
        if (reply) departmentId = channel.autoReplyDepartmentId;
      }
      if (departmentId !== undefined) {
        const validDepartment = settings.departments?.some((d: { id: string }) => d.id === departmentId) ? departmentId : null;
        conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { departmentId: validDepartment } });
      }
      // Never respond automatically while billing is suspended.
      if (tenant.status !== 'ACTIVE' || optOut) reply = null;
      return { duplicate: false as const, conversation, contact, message, isNewConversation, reply };
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

    if (saved.reply) {
      await this.sendAutoReply(channel, conversation.id, contact.waId, saved.reply);
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

        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
      },
      include: {
        contact: true,
        channel: { select: { id: true, name: true, type: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, direction: true, body: true, status: true, createdAt: true, fromNumber: true, toNumber: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      take: 100,
    });

    return conversations.map((c: (typeof conversations)[number]) => ({
      id: c.id,
      status: c.status,
      assignedUserId: c.assignedUserId,
      resolvedByName: c.resolvedByName,
      resolvedAt: c.resolvedAt,
      funnelStage: c.funnelStage,
      departmentId: c.departmentId,
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

  async setDepartment(tenantId: string, id: string, departmentId: string | null) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const conversation = await tx.conversation.findFirst({ where: { id, channel: { tenantId } } });
      if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      if (departmentId && !(tenant.workspaceSettings as any)?.departments?.some((d: { id: string }) => d.id === departmentId)) throw new NotFoundException('Setor nao encontrado.');
      return tx.conversation.update({ where: { id }, data: { departmentId, assignedUserId: null } });
    });
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

  async updateStatus(tenantId: string, conversationId: string, status: 'OPEN' | 'PENDING' | 'RESOLVED', actorId?: string) {
    await this.findOwnedConversation(tenantId, conversationId);
    const actor = actorId ? await this.prisma.user.findFirst({ where: { id: actorId, tenantId } }) : null;
    return this.prisma.$transaction(async tx => {
      const updated = await tx.conversation.update({ where: { id: conversationId }, data: {
        status, ...(status === 'RESOLVED' ? { resolvedById: actor?.id || null, resolvedByName: actor?.name || null, resolvedAt: new Date() } : {}),
      } });
      await tx.auditEvent.create({ data: { tenantId, actorId: actor?.id, action: `conversation.${status.toLowerCase()}:${conversationId}` } });
      return updated;
    });
  }

  async listMessages(tenantId: string, conversationId: string, cursor?: string) {
    await this.findOwnedConversation(tenantId, conversationId);
    return this.prisma.message.findMany({
      where: { conversationId },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { id: true, direction: true, body: true, status: true, createdAt: true, fromNumber: true, toNumber: true },
    });
  }

  async start(tenantId: string, dto: StartConversationDto) {
    return this.prisma.$transaction(async tx => {
      const channel = await tx.channel.findFirst({ where: { id: dto.channelId, tenantId } });
      if (!channel) throw new NotFoundException('Canal nao encontrado.');
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channel.id} FOR UPDATE`;
      const contact = await tx.contact.upsert({ where: { tenantId_waId: { tenantId, waId: dto.phone } },
        create: { tenantId, waId: dto.phone, name: dto.name || null }, update: {} });
      const existing = await tx.conversation.findFirst({ where: { channelId: channel.id, contactId: contact.id, status: { in: ['OPEN', 'PENDING'] } } });
      return existing || tx.conversation.create({ data: { channelId: channel.id, contactId: contact.id } });
    });
  }

  async renameContact(tenantId: string, id: string, name: string) {
    const conversation = await this.findOwnedConversation(tenantId, id);
    await this.prisma.contact.update({ where: { id: conversation.contactId }, data: { name: name.trim() } });
    return { updated: true };
  }

  async setStage(tenantId: string, id: string, stageId: string) {
    await this.findOwnedConversation(tenantId, id);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const settings = { ...defaults, ...tenant.workspaceSettings as object } as WorkspaceDto;
    if (!settings.stages.some(s => s.id === stageId)) throw new NotFoundException('Etapa nao encontrada.');
    // Moving manually never sends messages without an explicit send action.
    return this.prisma.conversation.update({ where: { id }, data: { funnelStage: stageId } });
  }

  async remove(tenantId: string, id: string, actorId: string) {
    return this.prisma.$transaction(async tx => {
      const conversation = await tx.conversation.findFirst({ where: { id, channel: { tenantId } }, include: { channel: true, contact: true } });
      if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
      if (conversation.channel.type !== 'QR_EVOLUTION') throw new ForbiddenException('Exclusao disponivel apenas para canais QR Code.');
      if (conversation.contact.legalHold) throw new ForbiddenException('Contato sob preservacao legal.');
      await tx.conversation.delete({ where: { id } });
      await tx.auditEvent.create({ data: { tenantId, actorId, action: 'conversation.deleted' } });
      return { deleted: true, scope: 'local_conversation_and_messages' };
    });
  }

  async sendTemplate(tenantId: string, conversationId: string, dto: TemplateMessageDto) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, channel: { tenantId } }, include: { channel: true, contact: true } });
    if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
    if (conversation.channel.type !== 'OFFICIAL_META') throw new ForbiddenException('Templates sao exclusivos da Meta.');
    const result = await this.metaConnector.sendTemplate(conversation.channel, conversation.contact.waId, dto);
    const message = await this.prisma.message.create({ data: {
      conversationId, direction: 'OUTBOUND', externalId: result.externalId,
      fromNumber: conversation.channel.externalId || '', toNumber: conversation.contact.waId,
      body: `[Template: ${dto.name} (${dto.language})]${dto.parameters.length ? ' ' + dto.parameters.join(' | ') : ''}`, status: 'SENT',
    } });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'PENDING' } });
    return message;
  }

  async sendMessage(tenantId: string, conversationId: string, text: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, channel: { tenantId } },
      include: { channel: true, contact: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa nao encontrada.');
    }

    if (conversation.channel.type === 'OFFICIAL_META') {
      const recent = await this.prisma.message.findFirst({ where: { conversationId, direction: 'INBOUND', createdAt: { gt: new Date(Date.now() - 24 * 3600000) } } });
      if (!recent) throw new ForbiddenException('Fora da janela de atendimento da Meta. Envie um template aprovado ou aguarde uma mensagem do cliente.');
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
