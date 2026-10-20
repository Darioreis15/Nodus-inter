import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ApiDelivery } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AttachmentSendService } from '../conversations/attachment-send.service';
import { unseal } from '../security/secrets';
import { cleared, contextFor, hash } from './delivery.service';
import { DeliveryPayload, deserializeFile } from './delivery-payload';
import { enabled, setting } from './delivery-input';

export function classifyDeliveryError(error:any):{state:'QUEUED'|'FAILED'|'REVIEW';code:string;delay:number}{
 const status=typeof error?.getStatus==='function'?error.getStatus():0;
 const body=typeof error?.getResponse==='function'?error.getResponse():{};
 // Retry only explicit refusals or the media-upload phase (no message submitted).
 if(body?.provider==='META' && ((body?.phase==='UPLOAD' && (!body.providerStatus || body.providerStatus>=500 || body.providerStatus===429)) || ([130429,131056,4,80007].includes(body.providerCode) && body.providerStatus<500)))return {state:'QUEUED',code:'PROVIDER_RETRY',delay:60};
 if([400,401,403,404,413,415].includes(status))return {state:'FAILED',code:`REJECTED_${status}`,delay:0};
 if(body?.provider==='META' && body.providerStatus>=400 && body.providerStatus<500 && Number.isInteger(body.providerCode))return {state:'FAILED',code:`META_${body.providerCode}`,delay:0};
 return {state:'REVIEW',code:'RESULT_UNCERTAIN',delay:0};
}
@Injectable()
export class DeliveryWorker implements OnModuleInit,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private running=false;private maintenanceAt=0;
 private logger=new Logger(DeliveryWorker.name);
 constructor(private prisma:PrismaService,private conversations:ConversationsService,private attachments:AttachmentSendService){}
 onModuleInit(){if(enabled() && process.env.API_QUEUE_WORKER_ENABLED==='true'){this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.warn('Falha no processamento da fila API.')),1000);this.timer.unref();}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async tick(){
  if(!enabled())return {enabled:false,processed:0};
  if(this.running)return {enabled:true,running:true,processed:0};
  this.running=true;
  try{
   const now=new Date();
   if(now.getTime()-this.maintenanceAt>60000){await this.maintenance(now);this.maintenanceAt=now.getTime();}
   const job=await this.claim(now);
   if(!job)return {enabled:true,processed:0};
   await this.dispatch(job);
   return {enabled:true,processed:1};
  }finally{this.running=false;}
 }
 async maintenance(now:Date){
  // A worker crash after a provider request cannot safely be treated as a retry.
  await this.prisma.apiDelivery.updateMany({where:{state:'PROCESSING',leaseUntil:{lt:now}},data:{state:'REVIEW',errorCode:'WORKER_INTERRUPTED',...cleared}});
  await this.prisma.apiDelivery.updateMany({where:{state:'QUEUED',expiresAt:{lt:now}},data:{state:'FAILED',errorCode:'EXPIRED',...cleared}});
  await this.prisma.apiDelivery.deleteMany({where:{state:{notIn:['QUEUED','PROCESSING']},updatedAt:{lt:new Date(now.getTime()-90*86400000)}}});
 }
 async claim(now:Date):Promise<ApiDelivery|null>{
  return this.prisma.$transaction(async tx=>{
   // A short cross-replica scheduler lock prevents competing tenant clocks.
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(742804)`;
   const candidates=await tx.apiDelivery.findMany({where:{state:'QUEUED',nextAttemptAt:{lte:now},expiresAt:{gt:now}},orderBy:[{nextAttemptAt:'asc'},{id:'asc'}],take:50});
   for(const job of candidates){
    await tx.$queryRaw`SELECT id FROM tenants WHERE id=${job.tenantId} FOR UPDATE`;
    const tenant=await tx.tenant.findUnique({where:{id:job.tenantId}});
    if(!tenant || tenant.status!=='ACTIVE'){
     await tx.apiDelivery.updateMany({where:{id:job.id,state:'QUEUED'},data:{state:'CANCELLED',errorCode:'TENANT_INACTIVE',...cleared}});continue;
    }
    if(tenant.apiDispatchAfter && tenant.apiDispatchAfter>now){
     await tx.apiDelivery.updateMany({where:{id:job.id,state:'QUEUED'},data:{nextAttemptAt:tenant.apiDispatchAfter}});continue;
    }
    // Never overlap sends for one tenant, even across replicas / slow providers.
    if(await tx.apiDelivery.findFirst({where:{tenantId:job.tenantId,state:'PROCESSING'},select:{id:true}})){
     await tx.apiDelivery.updateMany({where:{id:job.id,state:'QUEUED'},data:{nextAttemptAt:new Date(now.getTime()+1000)}});continue;
    }
    const claimed=await tx.apiDelivery.updateMany({where:{id:job.id,state:'QUEUED'},data:{state:'PROCESSING',attempts:{increment:1},leaseUntil:new Date(now.getTime()+300000)}});
    if(!claimed.count)continue;
    const pace=60000/setting('API_QUEUE_SENDS_PER_MINUTE',10,60);
    await tx.tenant.update({where:{id:job.tenantId},data:{apiDispatchAfter:new Date(now.getTime()+pace)}});
    return {...job,state:'PROCESSING',attempts:job.attempts+1};
   }
   return null;
  },{timeout:15000});
 }
 async dispatch(job:ApiDelivery){
  let providerStarted=false;
  try{
   const conversation=await this.prisma.conversation.findFirst({where:{id:job.conversationId,channel:{tenantId:job.tenantId}},include:{channel:{include:{tenant:true}},contact:true}});
   const active=await this.prisma.apiDelivery.findFirst({where:{id:job.id,state:'PROCESSING'},select:{id:true}});
   if(!active)return;
   let reason:string|undefined;
   if(!conversation || conversation.channel.tenant.status!=='ACTIVE')reason='TENANT_OR_CONVERSATION_REMOVED';
   else if(conversation.status==='RESOLVED')reason='CONVERSATION_RESOLVED';
   else if(conversation.channel.status!=='CONNECTED')reason='CHANNEL_DISCONNECTED';
   else if(!await this.prisma.apiKey.findFirst({where:{tenantId:job.tenantId,keyHash:job.apiKeyHash,revokedAt:null},select:{id:true}}))reason='API_KEY_REVOKED';
   else if(await this.prisma.campaignSuppression.findUnique({where:{tenantId_phoneHash:{tenantId:job.tenantId,phoneHash:hash(`${job.tenantId}:${conversation.contact.waId}`)}}}))reason='RECIPIENT_OPTED_OUT';
   if(reason){await this.prisma.apiDelivery.updateMany({where:{id:job.id,state:'PROCESSING'},data:{state:'CANCELLED',errorCode:reason,...cleared}});return;}
   const payload:DeliveryPayload=JSON.parse(unseal(job.payload!,contextFor(job.tenantId,job.id)));
   const file=deserializeFile(payload.file);
   providerStarted=true;
   const message=payload.kind==='TEXT'
    ? await this.conversations.sendMessage(job.tenantId,job.conversationId,payload.text!)
    : payload.kind==='ATTACHMENT'
     ? await this.attachments.send(job.tenantId,job.conversationId,file,payload.caption)
     : await this.conversations.sendTemplate(job.tenantId,job.conversationId,{name:payload.name!,language:payload.language!,parameters:payload.parameters!},true,file);
   await this.prisma.apiDelivery.updateMany({where:{id:job.id,state:'PROCESSING'},data:{state:'SENT',messageId:message.id,errorCode:null,...cleared}});
  }catch(error){
   const decision=providerStarted?classifyDeliveryError(error):{state:'REVIEW' as const,code:'PREPARATION_FAILED',delay:0};
   const retry=decision.state==='QUEUED' && job.attempts<5 && job.expiresAt>new Date();
   const nextAttemptAt=new Date(Date.now()+Math.min(3600,decision.delay*2**(job.attempts-1))*1000);
   await this.prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM tenants WHERE id=${job.tenantId} FOR UPDATE`;
    await tx.apiDelivery.updateMany({where:{id:job.id,state:'PROCESSING'},data:{state:retry?'QUEUED':decision.state==='QUEUED'?'FAILED':decision.state,errorCode:retry?decision.code:decision.state==='QUEUED'?'RETRIES_EXHAUSTED':decision.code,...(retry?{nextAttemptAt,leaseUntil:null}:cleared)}});
    if(retry){await tx.tenant.updateMany({where:{id:job.tenantId,OR:[{apiDispatchAfter:null},{apiDispatchAfter:{lt:nextAttemptAt}}]},data:{apiDispatchAfter:nextAttemptAt}});}
   });
  }
 }
}
