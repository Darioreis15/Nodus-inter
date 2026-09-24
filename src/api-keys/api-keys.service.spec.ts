import { ApiKeysService } from './api-keys.service';

describe('ApiKeysService', () => {
  let prisma: any;
  let service: ApiKeysService;

  beforeEach(() => {
    prisma = {
      apiKey: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    service = new ApiKeysService(prisma);
  });

  it('gera uma chave com o prefixo esperado e nunca guarda ela crua', async () => {
    prisma.apiKey.create.mockResolvedValue({});

    const result = await service.createForTenant('tenant-1', 'Integracao CRM');

    expect(result.key).toMatch(/^nodus_live_/);
    expect(prisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', name: 'Integracao CRM' }),
      }),
    );
    // o hash salvo tem que ser diferente da chave crua
    const savedData = prisma.apiKey.create.mock.calls[0][0].data;
    expect(savedData.keyHash).not.toBe(result.key);
  });

  describe('resolveTenantId', () => {
    it('retorna null para chave que nao comeca com o prefixo certo', async () => {
      const tenantId = await service.resolveTenantId('chave-invalida');
      expect(tenantId).toBeNull();
      expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
    });

    it('retorna null se a chave nao existir no banco', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);
      const tenantId = await service.resolveTenantId('nodus_live_algumacoisa');
      expect(tenantId).toBeNull();
    });

    it('retorna null se a chave estiver revogada', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        tenantId: 'tenant-1',
        revokedAt: new Date(),
      });
      const tenantId = await service.resolveTenantId('nodus_live_algumacoisa');
      expect(tenantId).toBeNull();
    });

    it('retorna o tenantId e atualiza lastUsedAt para chave valida', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', tenantId: 'tenant-1', revokedAt: null });

      const tenantId = await service.resolveTenantId('nodus_live_algumacoisa');

      expect(tenantId).toBe('tenant-1');
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'key-1' } }),
      );
    });
  });
});
