import { OUTBOUND_MIMES } from './outbound-file';
import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, UnauthorizedException, NotFoundException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { finalize } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RateGuard } from '../security/rate.guard';

export interface AttachmentFile { buffer: Buffer; mimetype: string; originalname: string; size: number }
export class AttachmentDto {
  @IsOptional() @IsString() @MaxLength(1024) caption?: string;
}

// Runs before Multer, so ownership and capacity are checked before buffering files.
@Injectable()
export class AttachmentUploadGate implements NestInterceptor {
  private active = 0;
  constructor(private prisma: PrismaService, private rate: RateGuard) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    if (!req.is('multipart/form-data')) throw new BadRequestException('Envie um arquivo como multipart/form-data.');
    const tenantId=req.user?.tenantId || req.apiTenantId;
    if(!tenantId) throw new UnauthorizedException();
    if(req.apiTenantId && !/^[a-zA-Z0-9_.:-]{8,128}$/.test(req.headers['idempotency-key'] || '')) throw new BadRequestException('Envie Idempotency-Key (8 a 128 caracteres).');
    const conversation = await this.prisma.conversation.findFirst({where:{id:req.params.id,channel:{tenantId}},select:{id:true}});
    if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
    await this.rate.consume(`upload:${tenantId}`, 10, 60000);
    if (this.active >= 2) throw new ServiceUnavailableException('Outros arquivos estao sendo enviados. Aguarde alguns segundos.');
    this.active++;
    return next.handle().pipe(finalize(() => this.active--));
  }
}
export const attachmentUploadOptions = {
  limits: {fileSize:10*1024*1024, files:1, fields:1, parts:2, fieldSize:8192},
  fileFilter: (_req: unknown, file: {mimetype:string}, cb: (error: Error|null, accept: boolean) => void) => {
    if (!OUTBOUND_MIMES.includes(file.mimetype)) return cb(new UnsupportedMediaTypeException('Selecione PDF, imagem ou documento Word, Excel ou PowerPoint.'),false);
    cb(null,true);
  },
};
