import { isPhoneSuppressed } from '../conversations/contact-identity';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { seal } from '../security/secrets';
import { AttachmentFile } from '../conversations/attachment-upload';
import { DeliveryDto, enabled, idempotencyKeyValid, setting } from './delivery-input';
import { deliveryPayload } from './delivery-payload';

export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const receiptSelect={id:true,conversationId:true,kind:true,state:true,messageId:true,errorCode:true,attempts:true,nextAttemptAt:true,expiresAt:true,createdAt:true,updatedAt:true} as const;
export const contextFor=(tenantId:string,id:string)=>`api-delivery:${tenantId}:${id}`;
export const cleared={payload:null,payloadBytes:0,leaseUntil:null};
@Injectable()
export class DeliveryService {
 constructor(private prisma:PrismaService){}
 async enqueue(tenantId:string,conversationId:string,key:string,apiKeyHash:string,dto:DeliveryDto,file?:AttachmentFile){
  if(!enabled())throw new ServiceUnavailableException('Fila de integracao desativada.');
  if(!idempotencyKeyValid(key))throw new BadRequestException('Informe Idempotency-Key valida.');
  const payload=deliveryPayload(dto,file), plain=JSON.stringify(payload);
  const fingerprint=hash(JSON.stringify([conversationId,payload])),keyHash=hash(key),id=randomUUID();
  const encrypted=seal(plain,contextFor(tenantId,id));
  return this.prisma.$transaction(async tx=>{
   // One admission lock protects aggregate quotas across replicas and companies.
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(742803)`;
   const conversation=await tx.conversation.findFirst({where:{id:conversationId,channel:{tenantId}},include:{channel:{include:{tenant:true}},contact:true}});
   if(!conversation)throw new NotFoundException('Conversa nao encontrada.');
   const previous=await tx.apiDelivery.findUnique({where:{tenantId_keyHash:{tenantId,keyHash}}});
   if(previous){
    if(previous.fingerprint!==fingerprint)throw new ConflictException('Idempotency-Key ja usada com outro conteudo.');
    return tx.apiDelivery.findUniqueOrThrow({where:{id:previous.id},select:receiptSelect});
   }
   if(conversation.channel.tenant.status!=='ACTIVE' || conversation.status==='RESOLVED' || conversation.channel.status!=='CONNECTED')throw new ForbiddenException('Empresa, canal ou conversa indisponivel para envio.');
   if(dto.kind==='TEMPLATE' && conversation.channel.type!=='OFFICIAL_META')throw new BadRequestException('Template exige canal oficial Meta.');
   if(conversation.channel.type==='OFFICIAL_META' && dto.kind!=='TEMPLATE'){
    if(file?.mimetype==='image/webp')throw new BadRequestException('WebP nao suportado pela Meta.');
    if(file?.mimetype.startsWith('image/') && file.buffer.length>5*1024*1024)throw new BadRequestException('Imagem Meta excede 5 MiB.');
    const inbound=await tx.message.findFirst({where:{conversationId,direction:'INBOUND',createdAt:{gt:new Date(Date.now()-86400000)}},select:{id:true}});
    if(!inbound)throw new ForbiddenException('Fora da janela Meta. Use template aprovado.');
   }
   if(!await tx.apiKey.findFirst({where:{tenantId,keyHash:apiKeyHash,revokedAt:null},select:{id:true}}))throw new ForbiddenException('Chave de API revogada.');
   if(await isPhoneSuppressed(tx,tenantId,conversation.contact.waId))throw new ForbiddenException('Destinatario solicitou interrupcao de mensagens.');
   const bytes=Buffer.byteLength(encrypted),tenantQuota=setting('API_QUEUE_TENANT_MIB',128,512)*1024*1024,globalQuota=setting('API_QUEUE_TOTAL_MIB',256,2048)*1024*1024;
   const [tenantUsage,totalUsage]=await Promise.all([
    tx.apiDelivery.aggregate({where:{tenantId},_sum:{payloadBytes:true},_count:true}),
    tx.apiDelivery.aggregate({_sum:{payloadBytes:true},_count:true}),
   ]);
   if((tenantUsage._sum.payloadBytes||0)+bytes>tenantQuota || (totalUsage._sum.payloadBytes||0)+bytes>globalQuota || tenantUsage._count>=10000 || totalUsage._count>=100000)throw new HttpException({statusCode:429,message:'Capacidade da fila atingida. Item nao aceito.',retryAfter:60},429);
   return tx.apiDelivery.create({data:{id,tenantId,conversationId,apiKeyHash,keyHash,fingerprint,kind:dto.kind,payload:encrypted,payloadBytes:bytes,expiresAt:new Date(Date.now()+7*86400000)},select:receiptSelect});
  },{timeout:15000});
 }
 async get(tenantId:string,id:string){
  const row=await this.prisma.apiDelivery.findFirst({where:{id,tenantId},select:receiptSelect});
  if(!row)throw new NotFoundException('Envio nao encontrado.');
  const message=row.messageId?await this.prisma.message.findFirst({where:{id:row.messageId,conversation:{channel:{tenantId}}},select:{status:true}}):null;
  return {...row,messageStatus:message?.status??null};
 }
 async list(tenantId:string,cursor?:string){
  if(cursor && !/^[0-9a-f-]{36}$/i.test(cursor))throw new BadRequestException('Cursor invalido.');
  const rows=await this.prisma.apiDelivery.findMany({where:{tenantId,...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:100,select:receiptSelect});
  return {items:rows,nextCursor:rows.length===100?rows[99].id:null};
 }
 async cancel(tenantId:string,id:string){
  const result=await this.prisma.apiDelivery.updateMany({where:{id,tenantId,state:'QUEUED'},data:{state:'CANCELLED',errorCode:'CANCELLED_BY_CLIENT',...cleared}});
  if(!result.count){const row=await this.get(tenantId,id);if(row.state!=='CANCELLED')throw new ConflictException('Somente envios aguardando podem ser cancelados.');}
  return this.get(tenantId,id);
 }
}
