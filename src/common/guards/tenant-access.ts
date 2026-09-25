import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export async function assertTenantAccess(
  prisma: PrismaService,
  tenantId: string | undefined,
  allowSuspended = false,
): Promise<void> {
  if (!tenantId) throw new UnauthorizedException('Tenant invalido.');
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });
  if (!tenant) throw new UnauthorizedException('Tenant nao encontrado.');
  if (tenant.status !== 'ACTIVE' && !allowSuspended) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: 'TENANT_SUSPENDED',
      message: 'Assinatura pendente. Regularize o pagamento para continuar.',
    });
  }
}
