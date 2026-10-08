import { Logger, NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  let prisma: any;
  let conversations: any;
  let service: WebhooksService;

  beforeEach(() => {
    prisma = {
      channel: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      message: { updateMany: jest.fn() },
    };
    conversations = { recordInboundMessage: jest.fn() };
    service = new WebhooksService(prisma, conversations);
  });

  describe('handleEvolutionEvent', () => {
    it('lanca NotFound se o canal do webhook nao existir', async () => {
      prisma.channel.findUnique.mockResolvedValue(null);

      await expect(service.handleEvolutionEvent('canal-invalido', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('atualiza status do canal em connection.update', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 'channel-1', status: 'PENDING' });

      await service.handleEvolutionEvent('channel-1', {
        event: 'connection.update',
        data: { state: 'open' },
      });

      expect(prisma.channel.update).toHaveBeenCalledWith({
        where: { id: 'channel-1' },
        data: { status: 'CONNECTED' },
      });
    });

    it('ignora mensagens que a propria instancia enviou (fromMe)', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 'channel-1', status: 'CONNECTED' });

      await service.handleEvolutionEvent('channel-1', {
        event: 'messages.upsert',
        data: { key: { fromMe: true } },
      });

      expect(conversations.recordInboundMessage).not.toHaveBeenCalled();
    });

    it.each([false, true, undefined])('aplica preferencia de grupos %s antes de persistir ou automatizar', async receiveGroupMessages => {
      prisma.channel.findUnique.mockResolvedValue({ id: 'channel-1', config: { receiveGroupMessages } });
      const payload = { event: 'messages.upsert', data: { key: { remoteJid: '1203630000@g.us' }, message: { conversation: 'grupo' } } };
      await expect(service.handleEvolutionEvent('channel-1', payload)).resolves.toEqual({ ok: true });
      expect(conversations.recordInboundMessage).toHaveBeenCalledTimes(receiveGroupMessages === false ? 0 : 1);
      conversations.recordInboundMessage.mockClear();
      payload.data.key.remoteJid = '5531999999999@s.whatsapp.net';
      await service.handleEvolutionEvent('channel-1', payload);
      expect(conversations.recordInboundMessage).toHaveBeenCalledTimes(1);
    });

    it('delega mensagem recebida em messages.upsert pro ConversationsService', async () => {
      const channel = { id: 'channel-1', status: 'CONNECTED', externalId: 'nodus-abc' };
      prisma.channel.findUnique.mockResolvedValue(channel);

      await service.handleEvolutionEvent('channel-1', {
        event: 'messages.upsert',
        data: {
          key: { fromMe: false, remoteJid: '5531999999999@s.whatsapp.net', id: 'evo-1' },
          message: { conversation: 'Oi, preciso de ajuda' },
        },
      });

      expect(conversations.recordInboundMessage).toHaveBeenCalledWith(
        channel,
        '5531999999999',
        'Oi, preciso de ajuda',
        'evo-1',
        expect.anything(),
        undefined,
      );
    });
  });

  describe('handleMetaEvent', () => {
    it('acha o canal pelo phone_number_id e delega a mensagem pro ConversationsService', async () => {
      const channel = { id: 'channel-2' };
      prisma.channel.findFirst.mockResolvedValue(channel);

      await service.handleMetaEvent({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '1234567890' },
                  messages: [{ id: 'wamid.1', from: '5531999999999', text: { body: 'Oi' } }],
                },
              },
            ],
          },
        ],
      });

      expect(prisma.channel.findFirst).toHaveBeenCalledWith({
        where: { type: 'OFFICIAL_META', externalId: '1234567890' },
      });
      expect(conversations.recordInboundMessage).toHaveBeenCalledWith(
        channel,
        '5531999999999',
        'Oi',
        'wamid.1',
        expect.anything(),
        undefined,
      );
    });

    it('registra codigo de falha sem expor texto bruto e limita a atualizacao ao canal', async () => {
      prisma.channel.findFirst.mockResolvedValue({ id: 'channel-2' });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        await service.handleMetaEvent({ entry: [{ changes: [{ value: {
          metadata: { phone_number_id: '123' },
          statuses: [{ id: 'wamid.failed', status: 'failed', errors: [
            { code: 130497, message: 'SECRET', error_data: { details: 'PHONE' } },
          ] }],
        } }] }] });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('codigo=130497'));
        expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SECRET|PHONE/);
        expect(prisma.message.updateMany).toHaveBeenCalledWith({
          where: { externalId: 'wamid.failed', conversation: { channelId: 'channel-2' } },
          data: { status: 'FAILED' },
        });
      } finally { warn.mockRestore(); }
    });

    it('atualiza status de mensagem enviada quando recebe um status update', async () => {
      prisma.channel.findFirst.mockResolvedValue({ id: 'channel-2' });

      await service.handleMetaEvent({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '1234567890' },
                  statuses: [{ id: 'wamid.1', status: 'delivered' }],
                },
              },
            ],
          },
        ],
      });

      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: { externalId: 'wamid.1', conversation: { channelId: 'channel-2' } },
        data: { status: 'DELIVERED' },
      });
    });
  });
});
