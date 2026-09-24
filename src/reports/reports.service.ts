import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getSummary(tenantId: string) {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const channelIds = channels.map((c: { id: string }) => c.id);

    if (channelIds.length === 0) {
      return {
        conversationsByStatus: { OPEN: 0, PENDING: 0, RESOLVED: 0 },
        messages: { inbound: 0, outbound: 0 },
        averageFirstResponseMinutes: null,
        messagesLast7Days: [],
      };
    }

    const [statusGroups, conversations] = await Promise.all([
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: { channelId: { in: channelIds } },
        _count: { _all: true },
      }),
      this.prisma.conversation.findMany({
        where: { channelId: { in: channelIds } },
        select: {
          id: true,
          messages: { orderBy: { createdAt: 'asc' }, select: { direction: true, createdAt: true } },
        },
      }),
    ]);

    const conversationsByStatus = { OPEN: 0, PENDING: 0, RESOLVED: 0 } as Record<string, number>;
    for (const group of statusGroups as Array<{ status: string; _count: { _all: number } }>) {
      conversationsByStatus[group.status] = group._count._all;
    }

    let inbound = 0;
    let outbound = 0;
    const responseTimesMs: number[] = [];
    const messagesByDay = new Map<string, number>();

    for (const conv of conversations as Array<{
      id: string;
      messages: Array<{ direction: string; createdAt: Date }>;
    }>) {
      let firstInbound: Date | null = null;
      let firstOutbound: Date | null = null;

      for (const msg of conv.messages) {
        if (msg.direction === 'INBOUND') inbound++;
        else outbound++;

        const day = msg.createdAt.toISOString().slice(0, 10);
        messagesByDay.set(day, (messagesByDay.get(day) ?? 0) + 1);

        if (msg.direction === 'INBOUND' && !firstInbound) firstInbound = msg.createdAt;
        if (msg.direction === 'OUTBOUND' && !firstOutbound) firstOutbound = msg.createdAt;
      }

      if (firstInbound && firstOutbound && firstOutbound > firstInbound) {
        responseTimesMs.push(firstOutbound.getTime() - firstInbound.getTime());
      }
    }

    const averageFirstResponseMinutes =
      responseTimesMs.length > 0
        ? Math.round(
            (responseTimesMs.reduce((sum, ms) => sum + ms, 0) / responseTimesMs.length / 60000) * 10,
          ) / 10
        : null;

    const last7Days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      last7Days.push({ date: key, count: messagesByDay.get(key) ?? 0 });
    }

    return {
      conversationsByStatus,
      messages: { inbound, outbound },
      averageFirstResponseMinutes,
      messagesLast7Days: last7Days,
    };
  }
}
