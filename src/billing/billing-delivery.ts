import { Transform } from 'class-transformer';
import { normalizePhone } from '../conversations/dto/normalize-phone';
import { sandboxBillingAvailable } from './sandbox-config';
import { saoPauloDate } from './billing-calendar';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient, CalendarPayment } from './asaas.client';
import { billingReference } from './billing-calendar';
import { assertPlatformOwner } from '../owner/owner-access';
import { ConversationsService } from '../conversations/conversations.service';
export class BillingDeliveryDto {
 @IsBoolean() emailEnabled:boolean;
 @IsBoolean() whatsappEnabled:boolean;
 @IsOptional() @IsEmail() @MaxLength(254) email?:string;
 @IsOptional() @Transform(({value})=>normalizePhone(value))
 @Matches(/^[1-9]\d{7,14}$/, {message:'Informe DDD e telefone brasileiro ou +DDI e numero para outros paises.'}) phone?:string;
 @IsOptional() @IsUUID() channelId?:string;
 @IsIn(['BOLETO','UNDEFINED','PIX']) billingType:string;
 @IsIn([true]) takeoverConfirmed:boolean;
 @IsString() @MinLength(1) @MaxLength(4096) currentPassword:string;
}
export class DeliveryReviewDto {
 @IsIn(['MARK_SENT','RETRY_CONFIRMED_NOT_SENT']) action:string;
 @IsString() @MinLength(1) @MaxLength(4096) currentPassword:string;
}
export function safeBillingLink(value:unknown) {
 if(typeof value!=='string')throw new Error('LINK_UNAVAILABLE');
 let url:URL;try{url=new URL(value);}catch{throw new Error('LINK_UNAVAILABLE');}
 if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !(url.hostname==='asaas.com'||url.hostname.endsWith('.asaas.com')))throw new Error('LINK_UNAVAILABLE');
 return url.href;
}
export function verifiedPayment(payment:CalendarPayment,cycle:any,sub:any) {
 if(payment.id!==cycle.paymentId || payment.customer!==sub.asaasCustomerId || payment.externalReference!==billingReference(sub.id,cycle.month) || payment.dueDate!==cycle.dueDate || Math.round(payment.value*100)!==cycle.valueCents)throw new Error('PAYMENT_MISMATCH');
 return !payment.deleted && ['PENDING','OVERDUE'].includes(payment.status);
}
@Injectable()
export class BillingDelivery implements OnModuleInit,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private running=false;private logger=new Logger(BillingDelivery.name);
 constructor(private prisma:PrismaService,private asaas:AsaasClient,private conversations:ConversationsService){}
 onModuleInit(){if(process.env.BILLING_DELIVERY_ENABLED==='true' && process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.run().catch(()=>this.logger.warn('Falha no processamento dos avisos de cobranca.')),60000);this.timer.unref();}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async owner(actorId:string,password?:string){const actor=await this.prisma.user.findUnique({where:{id:actorId}});assertPlatformOwner(actor||undefined);if(password!==undefined && (!actor || !await bcrypt.compare(password,actor.passwordHash)))throw new ForbiddenException('Senha incorreta.');return actor!;}
 async config(tenantId:string,actorId:string){
  const actor=await this.owner(actorId);
  const sub=await this.prisma.subscription.findUnique({where:{tenantId}});if(!sub)throw new NotFoundException('Contrato nao encontrado.');
  const history=await this.prisma.billingDelivery.findMany({where:{cycle:{subscriptionId:sub.id}},orderBy:{createdAt:'desc'},take:30,select:{id:true,kind:true,state:true,error:true,attemptedAt:true,updatedAt:true,cycle:{select:{month:true,dueDate:true,isTest:true}}}});
  const channels=await this.prisma.channel.findMany({where:{tenantId:actor.tenantId},select:{id:true,name:true,type:true,status:true}});
  const pendingTest=await this.prisma.billingCycle.findFirst({where:{subscriptionId:sub.id,isTest:true,state:'SENDING'},orderBy:{createdAt:'asc'}});
  const latestTest=await this.prisma.billingCycle.findFirst({where:{subscriptionId:sub.id,isTest:true,state:'CREATED',paymentId:{not:null},valueCents:500},orderBy:{createdAt:'desc'}});
  return {sandboxTest:{available:sandboxBillingAvailable(),cycleId:latestTest?.id||null,date:pendingTest?.month.slice(5)||saoPauloDate(),valueCents:500},enabled:sub.deliveryEnabled,settings:sub.deliverySettings,billingType:(sub.billingOptions as any)?.billingType||'UNDEFINED',history,channels,workerEnabled:process.env.BILLING_DELIVERY_ENABLED==='true',emailReady:!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM),metaTemplateReady:!!process.env.BILLING_WHATSAPP_TEMPLATE_NAME};
 }
 async save(tenantId:string,actorId:string,dto:BillingDeliveryDto){
  const actor=await this.owner(actorId,dto.currentPassword);
  if(dto.takeoverConfirmed!==true)throw new BadRequestException('Confirme a gestao de avisos pela Nodus.');
  if(dto.emailEnabled && !dto.email)throw new BadRequestException('Informe o e-mail financeiro.');
  if(dto.whatsappEnabled && (!dto.phone||!dto.channelId))throw new BadRequestException('Informe celular financeiro e canal remetente.');
  if(dto.channelId && !await this.prisma.channel.findFirst({where:{id:dto.channelId,tenantId:actor.tenantId}}))throw new BadRequestException('Selecione um canal da propria Nodus.');
  await this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
   const currentActor=await tx.user.findUnique({where:{id:actorId}});
   assertPlatformOwner(currentActor||undefined);
   if(currentActor?.passwordHash!==actor.passwordHash || currentActor.tokenVersion!==actor.tokenVersion)throw new ForbiddenException('Entre novamente.');
   const sub=await tx.subscription.findUnique({where:{tenantId}});if(!sub)throw new NotFoundException('Contrato nao encontrado.');
   const enabled=dto.emailEnabled||dto.whatsappEnabled;const previous=sub.deliverySettings as any;
   // This customer-only switch avoids duplicate Asaas + Nodus notifications.
   if(enabled)await this.asaas.setCustomerNotifications(sub.asaasCustomerId,true);
   const settings={emailEnabled:dto.emailEnabled,whatsappEnabled:dto.whatsappEnabled,email:dto.email||'',phone:dto.phone||'',channelId:dto.channelId||'',enabledAt:sub.deliveryEnabled&&previous.enabledAt?previous.enabledAt:new Date().toISOString()};
   await tx.subscription.update({where:{id:sub.id},data:{deliveryEnabled:enabled,deliverySettings:settings,billingOptions:{...(sub.billingOptions as object),billingType:dto.billingType}}});
   await tx.auditEvent.create({data:{tenantId,actorId,action:'billing.delivery.settings_updated'}});
  },{timeout:20000});
  return {saved:true};
 }
 async review(id:string,actorId:string,dto:DeliveryReviewDto){
  await this.owner(actorId,dto.currentPassword);
  const result=await this.prisma.billingDelivery.updateMany({where:{id,state:'REVIEW'},data:{state:dto.action==='MARK_SENT'?'SENT':'QUEUED',error:null,nextAttemptAt:new Date()}});
  if(!result.count)throw new ConflictException('Este envio nao esta em revisao.');
  await this.prisma.auditEvent.create({data:{actorId,action:`billing.delivery.review:${id}:${dto.action}`}});return {updated:true};
 }
 async run(){
  if(process.env.BILLING_DELIVERY_ENABLED!=='true')return {enabled:false};if(this.running)return {running:true};this.running=true;
  try{
   await this.prisma.billingDelivery.updateMany({where:{state:'SENDING',attemptedAt:{lt:new Date(Date.now()-15*60000)}},data:{state:'REVIEW',error:'DELIVERY_UNCERTAIN'}});
   const cycles=await this.prisma.billingCycle.findMany({where:{isTest:false,state:'CREATED',paymentId:{not:null},deliveries:{none:{}},subscription:{deliveryEnabled:true,status:{not:'CANCELED'}}},include:{subscription:true},orderBy:{createdAt:'asc'},take:100});
   for(const cycle of cycles){
    const prefs=cycle.subscription.deliverySettings as any;const eligible=Number.isFinite(Date.parse(prefs.enabledAt))&&cycle.createdAt.getTime()>=Date.parse(prefs.enabledAt);
    await this.prisma.billingDelivery.createMany({skipDuplicates:true,data:['EMAIL','WHATSAPP'].map(kind=>({cycleId:cycle.id,kind,state:eligible && (kind==='EMAIL'?prefs.emailEnabled:prefs.whatsappEnabled)?'QUEUED':'SKIPPED',error:eligible?null:'BEFORE_ACTIVATION'}))});
   }
   const rows=await this.prisma.billingDelivery.findMany({where:{state:{in:['QUEUED','RETRY']},nextAttemptAt:{lte:new Date()}},orderBy:{nextAttemptAt:'asc'},take:10});
   for(const row of rows)await this.process(row.id);
   return {enabled:true,processed:rows.length};
  }finally{this.running=false;}
 }
 async process(id:string){
  const row=await this.prisma.billingDelivery.findUnique({where:{id},include:{cycle:{include:{subscription:{include:{tenant:true}}}}}});
  if(!row || !['QUEUED','RETRY'].includes(row.state))return;
  const cycle=row.cycle,sub=cycle.subscription,prefs=sub.deliverySettings as any;
  let claimed=false;
  try{
   if(cycle.isTest && (!sandboxBillingAvailable() || process.env.BILLING_DELIVERY_ENABLED!=='true')){await this.skip(id,'SANDBOX_DISABLED');return;}
   if(cycle.isTest && row.kind==='WHATSAPP'){
    const target=row.testTarget as any;
    if(!target || target.phone!==prefs.phone || target.channelId!==prefs.channelId){await this.skip(id,'SANDBOX_TARGET_CHANGED');return;}
   }
   if(!sub.deliveryEnabled || sub.status==='CANCELED'||sub.cancellationPending || !(row.kind==='EMAIL'?prefs.emailEnabled:prefs.whatsappEnabled)){await this.skip(id,'DISABLED');return;}
   const payment=await this.asaas.getPayment(cycle.paymentId!);
   if(!verifiedPayment(payment,cycle,sub)){await this.skip(id,'PAYMENT_NOT_OPEN');return;}
   const link=safeBillingLink(payment.invoiceUrl); // One safe hosted invoice works for boleto/PIX; no arbitrary URL downloads.
   const value=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(payment.value);
   const due=payment.dueDate.split('-').reverse().join('/');
   const text=(cycle.isTest?'TESTE EM HOMOLOGAÇÃO — não efetue pagamento real.\n':'')+`Olá, ${sub.tenant.name}! Sua mensalidade Nodus de ${value} vence em ${due}.\nAcesse sua cobrança e o boleto disponível: ${link}\nSe já efetuou o pagamento, aguarde a compensação.`;
   let sender:any,channel:any,conversation:any;
   if(row.kind==='EMAIL'){
    if(!prefs.email || !process.env.RESEND_API_KEY || !process.env.MAIL_FROM)throw new Error('EMAIL_CONFIG_REQUIRED');
   }else{
    sender=await this.owner(process.env.PLATFORM_OWNER_USER_ID||'');
    channel=await this.prisma.channel.findFirst({where:{id:prefs.channelId||'',tenantId:sender.tenantId,status:'CONNECTED',tenant:{status:'ACTIVE'}}});
    if(!channel || !prefs.phone)throw new Error('WHATSAPP_CONFIG_REQUIRED');
    if(cycle.isTest && channel.type!=='QR_EVOLUTION'){await this.skip(id,'SANDBOX_EVOLUTION_ONLY');return;}
    if(channel.type==='OFFICIAL_META' && !process.env.BILLING_WHATSAPP_TEMPLATE_NAME)throw new Error('META_TEMPLATE_REQUIRED');
    conversation=await this.conversations.start(sender.tenantId,{channelId:channel.id,phone:prefs.phone,name:sub.tenant.name});
   }
   // Recheck subscription settings/cancellation while claiming. Network delivery follows the claim.
   const reserved=await this.prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${sub.tenantId} FOR UPDATE`;
    const current=await tx.subscription.findUniqueOrThrow({where:{id:sub.id}});
    if(!current.deliveryEnabled||current.status==='CANCELED'||current.cancellationPending||JSON.stringify(current.deliverySettings)!==JSON.stringify(sub.deliverySettings))return {count:0};
    return tx.billingDelivery.updateMany({where:{id,state:{in:['QUEUED','RETRY']}},data:{state:'SENDING',attemptedAt:new Date(),error:null}});
   });
   if(!reserved.count)return;claimed=true;
   let providerId:string;
   if(row.kind==='EMAIL'){
    const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`nodus-billing-${row.id}`},body:JSON.stringify({from:process.env.MAIL_FROM,to:[prefs.email],subject:`${cycle.isTest?'[TESTE SANDBOX] ':''}Mensalidade Nodus — vencimento ${due}`,text})});
    const data=await response.json().catch(()=>null);if(!response.ok||typeof data?.id!=='string')throw new Error('DELIVERY_UNCERTAIN');providerId=data.id;
   }else{
    const message=channel.type==='OFFICIAL_META'?await this.conversations.sendTemplate(sender.tenantId,conversation.id,{name:process.env.BILLING_WHATSAPP_TEMPLATE_NAME!,language:process.env.BILLING_WHATSAPP_TEMPLATE_LANGUAGE||'pt_BR',parameters:[sub.tenant.name,value,due,link]},false):await this.conversations.sendMessage(sender.tenantId,conversation.id,text,false);
    providerId=message.externalId || message.id;
   }
   await this.prisma.billingDelivery.update({where:{id},data:{state:'SENT',providerId,error:null}});
  }catch(error){
   const known=['PAYMENT_MISMATCH','LINK_UNAVAILABLE','EMAIL_CONFIG_REQUIRED','WHATSAPP_CONFIG_REQUIRED','META_TEMPLATE_REQUIRED'];
   const code=known.includes((error as Error).message)?(error as Error).message:claimed?'DELIVERY_UNCERTAIN':'PREFLIGHT_UNAVAILABLE';
   await this.prisma.billingDelivery.updateMany({where:{id,state:{in:claimed?['SENDING']:['QUEUED','RETRY']}},data:{state:claimed||code==='PAYMENT_MISMATCH'?'REVIEW':'RETRY',error:code,nextAttemptAt:new Date(Date.now()+15*60000)}});
  }
 }
 private async skip(id:string,error:string){await this.prisma.billingDelivery.updateMany({where:{id,state:{in:['QUEUED','RETRY']}},data:{state:'SKIPPED',error}});}
}
