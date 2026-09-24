import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async findCurrent(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: {
        plan: true,
        _count: { select: { users: true } },
      },
    });

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: {
        name: tenant.plan.name,
        maxChannels: tenant.plan.maxChannels,
        maxUsers: tenant.plan.maxUsers,
      },
      userCount: tenant._count.users,
    };
  }
}
