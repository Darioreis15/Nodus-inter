import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_SUSPENDED_TENANT } from '../decorators/allow-suspended-tenant.decorator';
import { assertTenantAccess } from './tenant-access';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private prisma: PrismaService, private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;
    const request = context.switchToHttp().getRequest();
    const allowSuspended = this.reflector.get<boolean>(
      ALLOW_SUSPENDED_TENANT, context.getHandler(),
    ) === true;
    await assertTenantAccess(this.prisma, request.user?.tenantId, allowSuspended);
    return true;
  }
}
