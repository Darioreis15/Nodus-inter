import { RateGuard } from '../../security/rate.guard';
import { ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_SUSPENDED_TENANT } from '../decorators/allow-suspended-tenant.decorator';
import { assertTenantAccess } from './tenant-access';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private prisma: PrismaService, private reflector: Reflector, private rate: RateGuard) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;
    const request = context.switchToHttp().getRequest();
    if (request.user?.mustChangePassword && !this.reflector.get<boolean>('allowPasswordChange', context.getHandler())) {
      throw new ForbiddenException('Troque sua senha antes de continuar.');
    }
    const allowSuspended = this.reflector.get<boolean>(
      ALLOW_SUSPENDED_TENANT, context.getHandler(),
    ) === true;
    await assertTenantAccess(this.prisma, request.user?.tenantId, allowSuspended);
    if (request.method === 'DELETE' && request.path.toLowerCase().startsWith('/privacy/')) await this.rate.consume(`privacy-erase:${request.user.userId}`, 5, 3600000);
    await this.rate.consume(`tenant:${request.user.tenantId}`, 600, 60000);
    await this.rate.consume(`user:${request.user.userId}`, 120, 60000);
    return true;
  }
}
