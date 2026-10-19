import { trackOutbound } from './pipeline';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionConnector } from '../channels/connectors/evolution.connector';
import { MetaConnector } from '../channels/connectors/meta.connector';
import { AttachmentFile } from './attachment-upload';
import { MEDIA_MAX_BYTES, mediaMetadata, publicMedia, validMediaBytes } from './message-media';

@Injectable()
export class AttachmentSendService {
  constructor(private prisma:PrismaService, private evolution:EvolutionConnector, private meta:MetaConnector) {}
  async send(tenantId:string, conversationId:string, file:AttachmentFile|undefined, caption = '') {
    const startedAt=new Date();
    const conversation = await this.prisma.conversation.findFirst({where:{id:conversationId,channel:{tenantId}},include:{channel:true,contact:true}});
    if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
    if(conversation.status==='RESOLVED') throw new ForbiddenException('Atendimento finalizado. Inicie uma nova conversa.');
    if (!file?.buffer?.length) throw new BadRequestException('Selecione um arquivo para enviar.');
    if (file.buffer.length > MEDIA_MAX_BYTES) throw new PayloadTooLargeException('Arquivo excede o limite de 10 MB.');
    const media = mediaMetadata(file.mimetype,file.originalname,undefined,file.buffer.length);
    if (!media || !validMediaBytes(file.buffer,media.mimeType)) throw new UnsupportedMediaTypeException('Conteudo do arquivo nao corresponde a um formato permitido.');
    if (typeof caption !== 'string' || caption.length > 1024) throw new BadRequestException('Legenda deve ter no maximo 1024 caracteres.');
    const channel = conversation.channel;
    if (channel.status !== 'CONNECTED') throw new ForbiddenException('Conecte o canal antes de enviar o arquivo.');
    if (channel.type === 'OFFICIAL_META') {
      if (media.mimeType === 'image/webp') throw new UnsupportedMediaTypeException('Para enviar fotos pela Meta, use JPEG ou PNG.');
      if (media.kind === 'image' && file.buffer.length > 5*1024*1024) throw new PayloadTooLargeException('Fotos enviadas pela Meta devem ter ate 5 MB.');
      const recent = await this.prisma.message.findFirst({where:{conversationId,direction:'INBOUND',createdAt:{gt:new Date(Date.now()-24*3600000)}}});
      if (!recent) throw new ForbiddenException('Fora da janela de atendimento da Meta. Aguarde uma mensagem do cliente ou envie um template aprovado.');
    }
    const result = await (channel.type === 'QR_EVOLUTION' ? this.evolution : this.meta).sendMedia(channel as any,{to:conversation.contact.waId,caption,buffer:file.buffer,media});
    const storedMedia = {...media,...(result.providerId ? {providerId:result.providerId} : {})};
    // Use the same locks as Evolution echoes to prevent a duplicate message when
    // the webhook arrives before the send response. Preserve delivered/read status.
    const saved = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channel.id} FOR UPDATE`;
      const existing = await tx.message.findFirst({where:{externalId:result.externalId,conversation:{channelId:channel.id},direction:'OUTBOUND'}});
      const data = {conversationId,direction:'OUTBOUND' as const,externalId:result.externalId,fromNumber:channel.externalId || '',toNumber:conversation.contact.waId,body:caption,media:storedMedia as unknown as Prisma.InputJsonValue};
      const message = existing ? await tx.message.update({where:{id:existing.id},data}) : await tx.message.create({data:{...data,status:'SENT'}});
      await trackOutbound(tx,tenantId,conversationId,startedAt);
      return message;
    });
    return {id:saved.id,conversationId,direction:saved.direction,body:saved.body,status:saved.status,createdAt:saved.createdAt,fromNumber:saved.fromNumber,toNumber:saved.toNumber,media:publicMedia(saved.media)};
  }
}
