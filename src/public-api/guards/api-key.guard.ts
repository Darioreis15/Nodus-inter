import { RateGuard } from '../../security/rate.guard';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertTenantAccess } from '../../common/guards/tenant-access';
import { ApiKeysService } from '../../api-keys/api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private apiKeys: ApiKeysService, private prisma: PrismaService, private rate: RateGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] as string | undefined;

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Envie a chave de API em "Authorization: Bearer <chave>".');
    }

    const rawKey = header.slice('Bearer '.length).trim();
    const tenantId = await this.apiKeys.resolveTenantId(rawKey);
    if (!tenantId) {
      throw new UnauthorizedException('Chave de API invalida ou revogada.');
    }

    await assertTenantAccess(this.prisma, tenantId);
    await this.rate.consume(`tenant:${tenantId}`, 600, 60000);
    request.apiTenantId = tenantId;
    return true;
  }
}
