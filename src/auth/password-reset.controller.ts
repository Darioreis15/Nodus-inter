import { Body, Controller, Post, BadRequestException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordBytes } from '../security/password';
class ForgotPasswordDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() email: string;
}
class ResetPasswordDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) token: string;
  @IsString() @MinLength(12) @MaxLength(4096) @PasswordBytes() newPassword: string;
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
@Controller('auth')
export class PasswordResetController {
  private logger = new Logger(PasswordResetController.name);
  constructor(private prisma: PrismaService) {}
  @Post('forgot-password')
  async forgot(@Body() dto: ForgotPasswordDto) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    const origin = process.env.FRONTEND_URL;
    if (!apiKey || !from || !origin || !/^https:\/\/[^/?#]+\/?$/.test(origin)) {
      throw new ServiceUnavailableException('Recuperacao por e-mail ainda nao configurada. Contate o administrador.');
    }
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (user) {
      const token = randomBytes(32).toString('hex');
      const tokenHash = digest(token);
      await this.prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await this.prisma.passwordReset.create({ data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 15 * 60000) } });
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [user.email], subject: 'Redefina sua senha — Nodus',
            text: `Recebemos uma solicitacao para redefinir sua senha. O link expira em 15 minutos e pode ser usado uma vez:\n${origin.replace(/\/$/, '')}/#reset=${token}\nSe nao foi voce, ignore este e-mail.` }),
        });
        if (!response.ok) throw new Error('Email delivery rejected');
      } catch {
        await this.prisma.passwordReset.deleteMany({ where: { tokenHash } });
        // No recipient, token or provider response in logs. Same public response for unknown emails.
        this.logger.error('Nao foi possivel enviar recuperacao de senha. Verifique o provedor de e-mail.');
      }
    }
    return { message: 'Se existir uma conta com esse e-mail, voce recebera as instrucoes de recuperacao.' };
  }
  @Post('reset-password')
  async reset(@Body() dto: ResetPasswordDto) {
    const tokenHash = digest(dto.token);
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.$transaction(async tx => {
      const record = await tx.passwordReset.findUnique({ where: { tokenHash } });
      if (!record || record.expiresAt <= new Date()) throw new BadRequestException('Link invalido ou expirado. Solicite outro.');
      const consumed = await tx.passwordReset.deleteMany({ where: { tokenHash, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw new BadRequestException('Link invalido ou expirado.');
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null } });
      await tx.passwordReset.deleteMany({ where: { userId: record.userId } });
    });
    return { message: 'Senha atualizada. Entre novamente.' };
  }
}
