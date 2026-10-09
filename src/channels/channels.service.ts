import { validateMetaToken, metaRequest } from './connectors/meta-api';
import { seal, unseal } from '../security/secrets';
import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ChannelRecord as Channel } from './channel.types';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto, ChannelTypeDto } from './dto/create-channel.dto';
import { EvolutionConnector } from './connectors/evolution.connector';

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private evolutionConnector: EvolutionConnector,
  ) {}

  async listForTenant(tenantId: string) {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return channels.map((c: (typeof channels)[number]) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      phoneNumber: (c.config as any)?.phoneNumber || null,
      receiveGroupMessages: (c.config as any)?.receiveGroupMessages !== false,
      onlyCustomerInitiated: (c.config as any)?.onlyCustomerInitiated !== false,
      autoReplyEnabled: c.autoReplyEnabled,
      autoReplyMessage: c.autoReplyMessage,
      autoReplyDepartmentId: c.autoReplyDepartmentId,
      createdAt: c.createdAt,
    }));
  }

  async createForTenant(tenantId: string, appBaseUrl: string, dto: CreateChannelDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true, _count: { select: { channels: true } } },
    });

    if (tenant._count.channels >= tenant.plan.maxChannels) {
      throw new ForbiddenException(
        `Limite de canais do plano ${tenant.plan.name} atingido (${tenant.plan.maxChannels}).`,
      );
    }

    if (dto.type === ChannelTypeDto.OFFICIAL_META) {
      await validateMetaToken(dto.phoneNumberId!, dto.accessToken!);
      return this.prisma.channel.create({
        select: { id: true, name: true, type: true, status: true },
        data: {
          tenantId,
          type: 'OFFICIAL_META',
          name: dto.name,
          status: 'CONNECTED', // numero ja precisa estar verificado na Meta antes de chegar aqui
          externalId: dto.phoneNumberId,
          config: {
            phoneNumberId: dto.phoneNumberId,
            accessToken: seal(dto.accessToken!, `meta:${dto.phoneNumberId}`),
            wabaId: dto.wabaId,
          },
        },
      });
    }

    // QR_EVOLUTION: cria o registro primeiro pra ter um id, so entao registra
    // a instancia na Evolution API usando esse id no nome e na URL do webhook.
    const instanceName = `nodus-${crypto.randomUUID()}`;
    const channel = await this.prisma.channel.create({
      data: {
        tenantId,
        type: 'QR_EVOLUTION',
        name: dto.name,
        status: 'PENDING',
        externalId: instanceName,
        config: { instanceName },
      },
    });

    await this.evolutionConnector.createInstance(
      instanceName,
      `${appBaseUrl}/webhooks/evolution/${channel.id}`,
    );

    return channel;
  }

  async findOwnedChannel(tenantId: string, channelId: string): Promise<Channel> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, tenantId },
    });
    if (!channel) {
      throw new NotFoundException('Canal nao encontrado.');
    }
    return channel;
  }

  async getQrCode(tenantId: string, channelId: string) {
    const channel = await this.findOwnedChannel(tenantId, channelId);
    if (channel.type !== 'QR_EVOLUTION') {
      throw new ForbiddenException('QR code so existe para canais do tipo QR_EVOLUTION.');
    }
    const config = channel.config as unknown as { instanceName: string };
    return this.evolutionConnector.getQrCode(config.instanceName);
  }

  async updateMetaToken(tenantId: string, channelId: string, accessToken: string) {
    const channel = await this.findOwnedChannel(tenantId, channelId);
    if (channel.type !== 'OFFICIAL_META') {
      throw new BadRequestException('Atualizacao de token disponivel apenas para canais OFFICIAL_META.');
    }
    const config = channel.config as Record<string, any>;
    if (!channel.externalId || !config || config.phoneNumberId !== channel.externalId) {
      throw new BadRequestException('Configuracao do numero Meta inconsistente.');
    }
    await validateMetaToken(channel.externalId, accessToken);
    await this.patchConfig(tenantId, channelId, { accessToken: seal(accessToken, `meta:${channel.externalId}`) });
    return { id: channelId, tokenUpdated: true };
  }

  async updateAutoReply(tenantId: string, channelId: string, enabled: boolean, message?: string, departmentId?: string | null, onlyCustomerInitiated?: boolean) {
    await this.findOwnedChannel(tenantId, channelId);
    if (enabled && !message) {
      throw new ForbiddenException('Informe a mensagem de resposta automatica pra habilitar.');
    }
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const current = await tx.channel.findFirstOrThrow({ where: { id: channelId, tenantId } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      if (departmentId && !(tenant.workspaceSettings as any)?.departments?.some((d: { id: string }) => d.id === departmentId)) throw new BadRequestException('Setor inexistente nesta empresa.');
      return tx.channel.update({
        select: { id: true, name: true, autoReplyEnabled: true, autoReplyMessage: true, autoReplyDepartmentId: true },
        where: { id: channelId, tenantId },
        data: { autoReplyEnabled: enabled, autoReplyMessage: enabled ? message : null,
          ...(onlyCustomerInitiated !== undefined ? { config: { ...(current.config as object), onlyCustomerInitiated } } : {}),
          ...(departmentId !== undefined ? { autoReplyDepartmentId: departmentId } : {}) },
      });
    });
  }

  async updateGroups(tenantId: string, channelId: string, receiveGroupMessages: boolean) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const channel = await tx.channel.findFirst({ where: { id: channelId, tenantId } });
      if (!channel) throw new NotFoundException('Canal nao encontrado.');
      if (channel.type !== 'QR_EVOLUTION') throw new BadRequestException('Preferencia de grupos disponivel para conexoes QR Code.');
      await tx.channel.update({ where: { id: channelId, tenantId }, data: { config: { ...(channel.config as object), receiveGroupMessages } }, select: { id: true } });
      return { id: channelId, receiveGroupMessages };
    });
  }

  // Provider calls can finish after an administrator saved preferences. Merge into
  // the current row under a lock so refresh/token rotation cannot undo that choice.
  private async patchConfig(tenantId: string, channelId: string, patch: Record<string, string | null>, status?: 'CONNECTED' | 'DISCONNECTED') {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const current = await tx.channel.findFirst({ where: { id: channelId, tenantId } });
      if (!current) throw new NotFoundException('Canal nao encontrado.');
      return tx.channel.update({ where: { id: channelId, tenantId }, data: {
        config: { ...(current.config as object), ...patch }, ...(status ? { status } : {}),
      }, select: { id: true } });
    });
  }

  async refresh(tenantId: string, channelId: string) {
    const channel = await this.findOwnedChannel(tenantId, channelId);
    const config = channel.config as Record<string, any>;
    let result: { status: 'CONNECTED' | 'DISCONNECTED'; phoneNumber: string | null };
    if (channel.type === 'QR_EVOLUTION') result = await this.evolutionConnector.connection(config.instanceName);
    else {
      const number = await metaRequest(`${encodeURIComponent(config.phoneNumberId)}?fields=id,display_phone_number`, unseal(config.accessToken, `meta:${config.phoneNumberId}`));
      result = { status: 'CONNECTED', phoneNumber: typeof number.display_phone_number === 'string' ? number.display_phone_number : null };
    }
    await this.patchConfig(tenantId, channelId, { phoneNumber: result.phoneNumber }, result.status);
    return { id: channelId, ...result };
  }

  async connectionAction(tenantId: string, channelId: string, action: 'disconnect' | 'restart') {
    const channel = await this.findOwnedChannel(tenantId, channelId);
    if (channel.type !== 'QR_EVOLUTION') throw new BadRequestException('Esta operacao e exclusiva de conexoes QR Code. Gerencie a conexao oficial na Meta.');
    const config = channel.config as { instanceName: string };
    await this.evolutionConnector[action](config.instanceName);
    await this.prisma.channel.update({ where: { id: channelId }, data: { status: action === 'disconnect' ? 'DISCONNECTED' : 'PENDING' } });
    return { ok: true };
  }

  async delete(tenantId: string, channelId: string) {
    const channel = await this.findOwnedChannel(tenantId, channelId);

    if (await this.prisma.conversation.count({ where: { channelId, contact: { legalHold: true } } })) throw new ForbiddenException('Canal possui contatos sob preservacao legal.');
    if (channel.type === 'QR_EVOLUTION') {
      const config = channel.config as unknown as { instanceName: string };
      await this.evolutionConnector.deleteInstance(config.instanceName);
    }

    await this.prisma.channel.delete({ where: { id: channelId } });
    return { deleted: true };
  }
}
