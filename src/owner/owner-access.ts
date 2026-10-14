import { ForbiddenException } from '@nestjs/common';
export function assertPlatformOwner(user: { userId?: string; id?: string; role?: string; mustChangePassword?: boolean } | undefined) {
  const configured = process.env.PLATFORM_OWNER_USER_ID?.trim();
  if (!configured || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(configured) || !user ||
      (user.userId || user.id) !== configured || user.role !== 'ADMIN' || user.mustChangePassword) {
    throw new ForbiddenException('Acesso exclusivo do proprietario da plataforma.');
  }
}
