import { jwtSecret } from '../security/config';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: jwtSecret(),
      signOptions: { expiresIn: '1h', algorithm: 'HS256', issuer: 'nodus', audience: 'nodus-api' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
