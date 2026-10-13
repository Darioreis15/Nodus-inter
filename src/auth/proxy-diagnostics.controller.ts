import { resolveClientIp } from '../security/client-ip';
import { Controller, Get, Header, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('auth/proxy-diagnostics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ProxyDiagnosticsController {
  @Get()
  @Header('Cache-Control', 'no-store')
  inspect(@Req() req: Request) {
    if (process.env.ENABLE_PROXY_DIAGNOSTICS !== 'true') throw new NotFoundException();
    // Forwarded headers are observations, NOT trusted evidence of client identity.
    const forwarded = req.get('x-forwarded-for');
    const trueClientIp = req.get('true-client-ip');
    const cfConnectingIp = req.get('cf-connecting-ip');
    const client = resolveClientIp(req);
    return {
      effectiveIp: client.ip,
      clientIpSource: client.source,
      expressIp: req.ip ?? null,
      socketIp: req.socket.remoteAddress ?? null,
      forwardedFor: forwarded?.slice(0, 1024) ?? null,
      forwardedForTruncated: (forwarded?.length ?? 0) > 1024,
      trueClientIp: trueClientIp?.slice(0, 128) ?? null,
      trueClientIpTruncated: (trueClientIp?.length ?? 0) > 128,
      cfConnectingIp: cfConnectingIp?.slice(0, 128) ?? null,
      cfConnectingIpTruncated: (cfConnectingIp?.length ?? 0) > 128,
      trustedChain: req.ips.slice(0, 20),
      trustedChainTruncated: req.ips.length > 20,
    };
  }
}
