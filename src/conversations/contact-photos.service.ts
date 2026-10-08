import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionConnector } from '../channels/connectors/evolution.connector';

// URLs only: never fetch a provider-supplied URL on the backend (no image proxy/SSRF).
export function safeProfilePhoto(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'whatsapp.net' || url.hostname.endsWith('.whatsapp.net'))) return null;
    return url.href;
  } catch { return null; }
}

@Injectable()
export class ContactPhotosService {
  private readonly cache = new Map<string, { url: string | null; expires: number }>();
  private readonly pending = new Map<string, Promise<string | null>>();
  constructor(private prisma: PrismaService, private evolution: EvolutionConnector) {}

  async forConversation(tenantId: string, id: string) {
    // Check ownership/existence on EVERY call, including cache hits and after deletion.
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, channel: { tenantId }, contact: { tenantId } },
      select: { contact: { select: { id: true, waId: true } }, channel: { select: { id: true, type: true, status: true, config: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
    const { channel, contact } = conversation;
    const instance = (channel.config as any)?.instanceName;
    if (channel.type !== 'QR_EVOLUTION' || channel.status !== 'CONNECTED' ||
      typeof instance !== 'string' || !instance || !/^\d{8,15}$/.test(contact.waId)) return { url: null };
    const key = JSON.stringify([tenantId, channel.id, contact.id, instance]);
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return { url: hit.url };
    this.cache.delete(key);
    const existing = this.pending.get(key);
    if (existing) return { url: await existing };
    // Bound provider concurrency even when many browsers open the same inbox.
    if (this.pending.size >= 8) return { url: null };
    const lookup = Promise.resolve().then(() => this.evolution.profilePicture(instance, contact.waId))
      .then(safeProfilePhoto).catch(() => null).then(url => {
        const now = Date.now();
        for (const [k,v] of this.cache) if (v.expires <= now) this.cache.delete(k);
        if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { url, expires: now + (url ? 300000 : 60000) });
        return url;
      }).finally(() => this.pending.delete(key));
    this.pending.set(key, lookup);
    return { url: await lookup };
  }
}
