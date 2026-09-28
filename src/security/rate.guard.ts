import { CanActivate, ExecutionContext, Injectable, HttpException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { jwtSecret } from './config';

@Injectable()
export class RateGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const path = (req.path as string).toLowerCase().replace(/\/+$/, '');
    const login = path === '/auth/login';
    const registration = path === '/auth/register';
    const webhook = path.startsWith('/webhooks/');
    const scope = login ? 'login' : registration ? 'register' : webhook ? 'webhooks' : 'api';
    const limit = login ? 10 : registration ? 5 : webhook ? 600 : 300;
    const ttl = registration ? 3600000 : 60000;
    const identity = req.ip || req.socket.remoteAddress;
    const result = await this.consume(`${scope}:ip:${identity}`, limit, ttl);
    if (login && typeof req.body?.email === 'string') {
      await this.consume(`login:account:${req.body.email.toLowerCase().trim()}`, 10, 900000);
    }
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - result.hits));
    return true;
  }
  async consume(identity: string, limit: number, ttl: number) {
    const now = Date.now();
    const window = Math.floor(now / ttl);
    const key = createHmac('sha256', jwtSecret()).update(`${identity}:${window}`).digest('hex');
    const expiresAt = new Date((window + 1) * ttl);
    const entry = await this.prisma.rateBucket.upsert({
      where: { key }, create: { key, hits: 1, expiresAt }, update: { hits: { increment: 1 } },
    });
    if (entry.hits > limit) throw new HttpException({ statusCode: 429, message: 'Limite de requisicoes atingido.', retryAfter: Math.ceil((expiresAt.getTime() - now) / 1000) }, 429);
    return entry;
  }
}

import { Global, Module } from '@nestjs/common';
@Global()
@Module({ providers: [RateGuard], exports: [RateGuard] })
export class SecurityModule {}
