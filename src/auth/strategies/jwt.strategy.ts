import { jwtSecret } from '../../security/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  ver: number;
  tenantId: string;
  role: 'ADMIN' | 'AGENT';
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
      algorithms: ['HS256'], issuer: 'nodus', audience: 'nodus-api',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.tenantId || !Number.isInteger(payload.ver)) throw new UnauthorizedException();
    const user = await this.prisma.user.findFirst({ where: { id: payload.sub, tenantId: payload.tenantId } });
    if (!user || user.tokenVersion !== payload.ver) throw new UnauthorizedException('Sessao revogada.');
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: user.role,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
