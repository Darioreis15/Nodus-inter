import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AttachmentFile } from '../conversations/attachment-upload';
import { validateOutboundFile } from '../conversations/outbound-file';
import { idempotencyKeyValid, PublicTemplateDto } from './delivery-input';
@Injectable()
export class PublicTemplatesService {
 constructor(private prisma:PrismaService,private conversations:ConversationsService){}
 async send(tenantId:string,id:string,dto:PublicTemplateDto,key?:string,file?:AttachmentFile){
  if(file)validateOutboundFile(file,true);
  if(!key && !file)return this.conversations.sendTemplate(tenantId,id,dto);
  if(!idempotencyKeyValid(key))throw new BadRequestException('Informe Idempotency-Key valida.');
  const keyHash=createHash('sha256').update(`template:${key}`).digest('hex');
  const fingerprint=createHash('sha256').update(JSON.stringify([id,dto.name,dto.language,dto.parameters,file?.mimetype,file?.originalname])).update(file?.buffer||Buffer.alloc(0)).digest('hex');
  let record;
  try{record=await this.prisma.publicAttachmentRequest.create({data:{tenantId,keyHash,fingerprint}});}
  catch(error){
   if((error as any)?.code!=='P2002')throw error;
   const previous=await this.prisma.publicAttachmentRequest.findUniqueOrThrow({where:{tenantId_keyHash:{tenantId,keyHash}}});
   if(previous.fingerprint!==fingerprint)throw new ConflictException('Idempotency-Key ja usada com outro conteudo.');
   if(previous.state==='SENT')return previous.response;
   throw new ConflictException('Envio sem confirmacao ou em processamento. Consulte a conversa antes de repetir.');
  }
  try{
   const message=await this.conversations.sendTemplate(tenantId,id,dto,true,file);
   const response={id:message.id,conversationId:id,status:message.status};
   await this.prisma.publicAttachmentRequest.update({where:{id:record.id},data:{state:'SENT',response}});
   return response;
  }catch(error){await this.prisma.publicAttachmentRequest.updateMany({where:{id:record.id,state:'SENDING'},data:{state:'REVIEW'}});throw error;}
 }
}
