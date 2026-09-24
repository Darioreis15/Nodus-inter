import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
      return this.prisma.channel.create({
        data: {
          tenantId,
          type: 'OFFICIAL_META',
          name: dto.name,
          status: 'CONNECTED', // numero ja precisa estar verificado na Meta antes de chegar aqui
          externalId: dto.phoneNumberId,
          config: {
            phoneNumberId: dto.phoneNumberId,
            accessToken: dto.accessToken,
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

  async updateAutoReply(tenantId: string, channelId: string, enabled: boolean, message?: string) {
    await this.findOwnedChannel(tenantId, channelId);
    if (enabled && !message) {
      throw new ForbiddenException('Informe a mensagem de resposta automatica pra habilitar.');
    }
    return this.prisma.channel.update({
      where: { id: channelId },
      data: { autoReplyEnabled: enabled, autoReplyMessage: enabled ? message : null },
    });
  }

  async delete(tenantId: string, channelId: string) {
    const channel = await this.findOwnedChannel(tenantId, channelId);

    if (channel.type === 'QR_EVOLUTION') {
      const config = channel.config as unknown as { instanceName: string };
      // Best-effort: mesmo se a Evolution API estiver fora do ar ou a
      // instancia ja nao existir mais la, o canal ainda tem que sumir daqui.
      try {
        await this.evolutionConnector.deleteInstance(config.instanceName);
      } catch {
        // segue o fluxo -- o importante e limpar o nosso lado
      }
    }

    await this.prisma.channel.delete({ where: { id: channelId } });
    return { deleted: true };
  }
}
