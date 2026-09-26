import { seal } from '../security/secrets';
import { deliverWebhook } from '../security/safe-webhook';
jest.mock('../security/safe-webhook', () => ({ resolveWebhook: jest.fn().mockResolvedValue({}), deliverWebhook: jest.fn() }));
import { OutboundWebhooksService } from './outbound-webhooks.service';

describe('OutboundWebhooksService', () => {
  let prisma: any;
  let service: OutboundWebhooksService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    prisma = {
      webhookSubscription: { count: jest.fn().mockResolvedValue(0), create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    service = new OutboundWebhooksService(prisma);
    fetchMock = deliverWebhook as jest.Mock;
    fetchMock.mockReset().mockResolvedValue(200);
  });

  it('so entrega pra assinaturas que escutam aquele evento especifico', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', url: 'https://a.com/hook', tenantId: 'tenant-1', secret: seal('s1', 'webhook:tenant-1'), events: ['message.received'] },
      { id: 'sub-2', url: 'https://b.com/hook', tenantId: 'tenant-1', secret: seal('s2', 'webhook:tenant-1'), events: ['conversation.assigned'] },
    ]);

    await service.dispatch('tenant-1', 'message.received', { conversationId: 'conv-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://a.com/hook', expect.any(String), expect.any(Object));
  });

  it('assina o payload com HMAC usando o secret da assinatura', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', url: 'https://a.com/hook', tenantId: 'tenant-1', secret: seal('segredo-123', 'webhook:tenant-1'), events: ['message.received'] },
    ]);

    await service.dispatch('tenant-1', 'message.received', { conversationId: 'conv-1' });

    const [, , headers] = fetchMock.mock.calls[0];
    expect(headers['X-Nodus-Signature']).toBeDefined();
    expect(headers['X-Nodus-Event']).toBe('message.received');
  });

  it('uma entrega falhando nao derruba as outras nem lanca erro pra quem chamou', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', url: 'https://fora-do-ar.com/hook', tenantId: 'tenant-1', secret: seal('s1', 'webhook:tenant-1'), events: ['message.received'] },
      { id: 'sub-2', url: 'https://b.com/hook', tenantId: 'tenant-1', secret: seal('s2', 'webhook:tenant-1'), events: ['message.received'] },
    ]);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(200);

    await expect(
      service.dispatch('tenant-1', 'message.received', { conversationId: 'conv-1' }),
    ).resolves.not.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('createForTenant devolve o secret cru so na criacao', async () => {
    prisma.webhookSubscription.create.mockResolvedValue({
      id: 'sub-1',
      url: 'https://a.com/hook',
      events: ['message.received'],
    });

    const result = await service.createForTenant('tenant-1', {
      url: 'https://a.com/hook',
      events: ['message.received'],
    } as any);

    expect(result.secret).toBeDefined();
    expect(typeof result.secret).toBe('string');
  });
});
