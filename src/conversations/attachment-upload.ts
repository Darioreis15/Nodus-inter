import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, NotFoundException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
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
    const conversation = await this.prisma.conversation.findFirst({where:{id:req.params.id,channel:{tenantId:req.user.tenantId}},select:{id:true}});
    if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
    await this.rate.consume(`upload:${req.user.tenantId}`, 10, 60000);
    if (this.active >= 2) throw new ServiceUnavailableException('Outros arquivos estao sendo enviados. Aguarde alguns segundos.');
    this.active++;
    return next.handle().pipe(finalize(() => this.active--));
  }
}
export const attachmentUploadOptions = {
  limits: {fileSize:10*1024*1024, files:1, fields:1, parts:2, fieldSize:8192},
  fileFilter: (_req: unknown, file: {mimetype:string}, cb: (error: Error|null, accept: boolean) => void) => {
    if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype)) return cb(new UnsupportedMediaTypeException('Selecione uma imagem JPEG/PNG/WebP ou PDF.'),false);
    cb(null,true);
  },
};
