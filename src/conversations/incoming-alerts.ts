import { BadRequestException } from '@nestjs/common';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { conversationAccess } from './conversation-access.guard';
export class IncomingAlertsQuery {
  @IsOptional() @IsISO8601() since?: string;
  @IsOptional() @IsISO8601() until?: string;
  @IsOptional() @IsISO8601() afterTime?: string;
  @IsOptional() @IsUUID() afterId?: string;
}
// Only IDs and timestamps. Overlap allows late commits; browser deduplicates IDs.
export async function incomingAlerts(prisma: PrismaService, user: AuthenticatedUser, q: IncomingAlertsQuery, now = new Date()) {
  if (!q.since) return { items: [], next: { since: now.toISOString() }, initialized: true };
  const since = new Date(q.since), until = q.until ? new Date(q.until) : now;
  if (since > until || until > now || Number.isNaN(+since) || Number.isNaN(+until) ||
      !!q.afterId !== !!q.afterTime || (q.afterTime && (new Date(q.afterTime) > until || new Date(q.afterTime) < new Date(+since - 30000)))) {
    throw new BadRequestException('Intervalo de notificacoes invalido.');
  }
  if (+now - +since > 86400000) return { items: [], next: { since: now.toISOString() }, initialized: true };
  const rows = await prisma.message.findMany({
    where: { direction: 'INBOUND', conversation: conversationAccess(user),
      createdAt: { gte: new Date(+since - 30000), lte: until },
      ...(q.afterId ? { OR: [{ createdAt: { gt: new Date(q.afterTime!) } }, { createdAt: new Date(q.afterTime!), id: { gt: q.afterId } }] } : {}),
    },
    select: { id: true, conversationId: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101,
  });
  const items = rows.slice(0, 100), last = items.at(-1);
  return { items, next: rows.length > 100 && last
    ? { since: q.since, until: until.toISOString(), afterTime: last.createdAt.toISOString(), afterId: last.id }
    : { since: until.toISOString() }, initialized: false };
}
