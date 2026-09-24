import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

describe('ConversationsService', () => {
  let prisma: any;
  let contacts: any;
  let evolutionConnector: any;
  let metaConnector: any;
  let outboundWebhooks: any;
  let service: ConversationsService;

  beforeEach(() => {
    prisma = {
      contact: { findUnique: jest.fn(), create: jest.fn() },
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      message: { create: jest.fn().mockResolvedValue({ id: 'msg-default' }), findMany: jest.fn() },
      user: { findFirst: jest.fn() },
    };
    contacts = { findOrCreate: jest.fn() };
    evolutionConnector = { sendText: jest.fn() };
    metaConnector = { sendText: jest.fn() };
    outboundWebhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
    service = new ConversationsService(prisma, contacts, evolutionConnector, metaConnector, outboundWebhooks);
  });

  describe('recordInboundMessage', () => {
    const channel = {
      id: 'channel-1',
      tenantId: 'tenant-1',
      externalId: 'nodus-abc',
      type: 'QR_EVOLUTION' as const,
      autoReplyEnabled: false,
      autoReplyMessage: null,
    };

    it('cria uma conversa nova quando nao existe nenhuma aberta com esse contato', async () => {
      contacts.findOrCreate.mockResolvedValue({ id: 'contact-1' });
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'conv-1', status: 'OPEN' });

      await service.recordInboundMessage(channel, '5531999999999', 'Oi', 'ext-1', {});

      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channelId: 'channel-1', contactId: 'contact-1', status: 'OPEN' }),
        }),
      );
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ conversationId: 'conv-1' }) }),
      );
    });

    it('reaproveita conversa OPEN existente em vez de criar outra', async () => {
      contacts.findOrCreate.mockResolvedValue({ id: 'contact-1' });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-2', status: 'OPEN' });

      await service.recordInboundMessage(channel, '5531999999999', 'De novo', 'ext-2', {});

      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ conversationId: 'conv-2' }) }),
      );
    });

    it('reabre conversa PENDING (cliente respondeu de novo) trazendo ela de volta pra OPEN', async () => {
      contacts.findOrCreate.mockResolvedValue({ id: 'contact-1' });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-3', status: 'PENDING' });
      prisma.conversation.update.mockResolvedValue({ id: 'conv-3', status: 'OPEN' });

      await service.recordInboundMessage(channel, '5531999999999', 'Alguem ai?', 'ext-3', {});

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-3' },
        data: { status: 'OPEN' },
      });
    });
  });

  describe('assign', () => {
    it('rejeita atribuir pra um usuario de outro tenant', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.assign('tenant-1', 'conv-1', 'user-de-outro-tenant')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lanca NotFound se a conversa nao for do tenant', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(service.assign('tenant-1', 'conv-de-outro-tenant', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('sendMessage', () => {
    it('envia pelo conector certo e marca a conversa como PENDING (aguardando cliente)', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        channel: { id: 'channel-1', type: 'QR_EVOLUTION', externalId: 'nodus-abc' },
        contact: { waId: '5531999999999' },
      });
      evolutionConnector.sendText.mockResolvedValue({ externalId: 'evo-1' });
      prisma.message.create.mockResolvedValue({ id: 'msg-1' });

      await service.sendMessage('tenant-1', 'conv-1', 'Ja te ajudo');

      expect(evolutionConnector.sendText).toHaveBeenCalled();
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { status: 'PENDING' },
      });
    });
  });
});
