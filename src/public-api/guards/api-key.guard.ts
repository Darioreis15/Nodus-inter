import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeysService } from '../../api-keys/api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private apiKeys: ApiKeysService) {}

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

    request.apiTenantId = tenantId;
    return true;
  }
}
