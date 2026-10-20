import { BadRequestException, Body, ConflictException, Controller, Headers, Injectable, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentSendService } from '../conversations/attachment-send.service';
import { AttachmentDto, AttachmentFile, AttachmentUploadGate, attachmentUploadOptions } from '../conversations/attachment-upload';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CurrentApiTenant } from './decorators/current-api-tenant.decorator';
@Injectable()
export class PublicAttachmentsService {
 constructor(private prisma:PrismaService,private sender:AttachmentSendService) {}
 async send(tenantId:string,id:string,key:string,file:AttachmentFile|undefined,caption='') {
  if(!/^[a-zA-Z0-9_.:-]{8,128}$/.test(key || '') || !file?.buffer?.length)throw new BadRequestException('Informe arquivo e Idempotency-Key validos.');
  const keyHash=createHash('sha256').update(key).digest('hex');
  const fingerprint=createHash('sha256').update(JSON.stringify([id,caption,file.mimetype,file.originalname])).update(file.buffer).digest('hex');
  let record;
  try{record=await this.prisma.publicAttachmentRequest.create({data:{tenantId,keyHash,fingerprint}});}
  catch(error){
   if((error as any)?.code!=='P2002')throw error;
   const previous=await this.prisma.publicAttachmentRequest.findUniqueOrThrow({where:{tenantId_keyHash:{tenantId,keyHash}}});
   if(previous.fingerprint!==fingerprint)throw new ConflictException('Idempotency-Key ja usada com outro conteudo.');
   if(previous.state==='SENT')return previous.response;
   throw new ConflictException('Envio em processamento ou sem confirmacao. Consulte a conversa; nao gere outra chave para repetir.');
  }
  try{
   const message=await this.sender.send(tenantId,id,file,caption);
   // Persist only a receipt, never a second copy of the attachment or contact data.
   const response={id:message.id,conversationId:id,status:message.status};
   await this.prisma.publicAttachmentRequest.update({where:{id:record.id},data:{state:'SENT',response}});
   return response;
  }catch(error){
   await this.prisma.publicAttachmentRequest.updateMany({where:{id:record.id,state:'SENDING'},data:{state:'REVIEW'}});
   throw error;
  }
 }
}
@Controller('public/v1/conversations')
@UseGuards(ApiKeyGuard)
export class PublicAttachmentsController {
 constructor(private service:PublicAttachmentsService){}
 @Post(':id/attachments')
 @UseInterceptors(AttachmentUploadGate,FileInterceptor('file',attachmentUploadOptions))
 send(@CurrentApiTenant() tenantId:string,@Param('id') id:string,@Headers('idempotency-key') key:string,@UploadedFile() file:AttachmentFile|undefined,@Body() dto:AttachmentDto){return this.service.send(tenantId,id,key,file,dto.caption);}
}
