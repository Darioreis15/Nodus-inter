import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContactRecord } from './conversation.types';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async findOrCreate(tenantId: string, waId: string, name?: string): Promise<ContactRecord> {
    const existing = await this.prisma.contact.findUnique({
      where: { tenantId_waId: { tenantId, waId } },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.contact.create({
      data: { tenantId, waId, name: name ?? null },
    });
  }

  async listForTenant(tenantId: string) {
    return this.prisma.contact.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
