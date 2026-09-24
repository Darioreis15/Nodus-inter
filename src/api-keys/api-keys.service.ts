import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const KEY_PREFIX = 'nodus_live_';

function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  async createForTenant(tenantId: string, name: string) {
    const rawKey = `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + 6);

    await this.prisma.apiKey.create({
      data: { tenantId, name, keyHash, keyPrefix },
    });

    // A chave crua so existe nessa resposta -- nao da pra recupera-la depois.
    return { key: rawKey, keyPrefix, name };
  }

  async listForTenant(tenantId: string) {
    const keys = await this.prisma.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return keys.map((k: (typeof keys)[number]) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    }));
  }

  async revoke(tenantId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!key) {
      throw new NotFoundException('Chave de API nao encontrada.');
    }
    return this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /** Usado pelo ApiKeyGuard -- retorna o tenantId dono da chave, ou null se invalida/revogada. */
  async resolveTenantId(rawKey: string): Promise<string | null> {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      return null;
    }
    const keyHash = hashKey(rawKey);
    const key = await this.prisma.apiKey.findFirst({ where: { keyHash } });
    if (!key || key.revokedAt) {
      return null;
    }

    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return key.tenantId;
  }
}
