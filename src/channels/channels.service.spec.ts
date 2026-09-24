import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelTypeDto } from './dto/create-channel.dto';

describe('ChannelsService', () => {
  let prisma: any;
  let evolutionConnector: any;
  let service: ChannelsService;

  beforeEach(() => {
    prisma = {
      tenant: { findUniqueOrThrow: jest.fn() },
      channel: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    };
    evolutionConnector = {
      createInstance: jest.fn(),
      getQrCode: jest.fn(),
      sendText: jest.fn(),
      deleteInstance: jest.fn().mockResolvedValue(undefined),
    };
    service = new ChannelsService(prisma, evolutionConnector);
  });

  describe('createForTenant', () => {
    it('bloqueia criacao quando o plano atingiu o limite de canais', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        id: 'tenant-1',
        plan: { name: 'Starter', maxChannels: 1 },
        _count: { channels: 1 },
      });

      await expect(
        service.createForTenant('tenant-1', 'https://app.exemplo.com', {
          name: 'Atendimento',
          type: ChannelTypeDto.QR_EVOLUTION,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.channel.create).not.toHaveBeenCalled();
    });

    it('cria canal oficial da Meta ja como CONNECTED, sem chamar a Evolution API', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        id: 'tenant-1',
        plan: { name: 'Pro', maxChannels: 5 },
        _count: { channels: 0 },
      });
      prisma.channel.create.mockResolvedValue({ id: 'channel-1', status: 'CONNECTED' });

      await service.createForTenant('tenant-1', 'https://app.exemplo.com', {
        name: 'Numero oficial',
        type: ChannelTypeDto.OFFICIAL_META,
        phoneNumberId: '1234567890',
        accessToken: 'token-secreto',
      });

      expect(evolutionConnector.createInstance).not.toHaveBeenCalled();
      expect(prisma.channel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'OFFICIAL_META', status: 'CONNECTED' }),
        }),
      );
    });

    it('cria instancia na Evolution API para canal QR_EVOLUTION, com webhook apontando pro channel id', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        id: 'tenant-1',
        plan: { name: 'Pro', maxChannels: 5 },
        _count: { channels: 0 },
      });
      prisma.channel.create.mockResolvedValue({ id: 'channel-2', status: 'PENDING' });

      await service.createForTenant('tenant-1', 'https://app.exemplo.com', {
        name: 'Atendimento via QR',
        type: ChannelTypeDto.QR_EVOLUTION,
      });

      expect(evolutionConnector.createInstance).toHaveBeenCalledWith(
        expect.stringMatching(/^nodus-/),
        'https://app.exemplo.com/webhooks/evolution/channel-2',
      );
    });
  });

  describe('findOwnedChannel', () => {
    it('lanca NotFound quando o canal nao pertence ao tenant', async () => {
      prisma.channel.findFirst.mockResolvedValue(null);

      await expect(service.findOwnedChannel('tenant-1', 'channel-de-outro-tenant')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('deleta a instancia na Evolution API antes de apagar o canal do banco', async () => {
      prisma.channel.findFirst.mockResolvedValue({
        id: 'channel-1',
        tenantId: 'tenant-1',
        type: 'QR_EVOLUTION',
        config: { instanceName: 'nodus-abc' },
      });
      prisma.channel.delete = jest.fn().mockResolvedValue({});

      await service.delete('tenant-1', 'channel-1');

      expect(evolutionConnector.deleteInstance).toHaveBeenCalledWith('nodus-abc');
      expect(prisma.channel.delete).toHaveBeenCalledWith({ where: { id: 'channel-1' } });
    });

    it('nao falha se a Evolution API estiver fora do ar -- ainda assim apaga do banco', async () => {
      prisma.channel.findFirst.mockResolvedValue({
        id: 'channel-1',
        tenantId: 'tenant-1',
        type: 'QR_EVOLUTION',
        config: { instanceName: 'nodus-abc' },
      });
      evolutionConnector.deleteInstance.mockRejectedValue(new Error('fora do ar'));
      prisma.channel.delete = jest.fn().mockResolvedValue({});

      await expect(service.delete('tenant-1', 'channel-1')).resolves.toEqual({ deleted: true });
      expect(prisma.channel.delete).toHaveBeenCalled();
    });

    it('canal oficial da Meta nao tenta chamar a Evolution API', async () => {
      prisma.channel.findFirst.mockResolvedValue({
        id: 'channel-2',
        tenantId: 'tenant-1',
        type: 'OFFICIAL_META',
        config: { phoneNumberId: '123' },
      });
      prisma.channel.delete = jest.fn().mockResolvedValue({});

      await service.delete('tenant-1', 'channel-2');

      expect(evolutionConnector.deleteInstance).not.toHaveBeenCalled();
    });
  });
});
