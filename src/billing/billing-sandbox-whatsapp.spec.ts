import { BillingSandbox } from './billing-sandbox';
import * as bcrypt from 'bcryptjs';

describe('Sandbox WhatsApp authorization', () => {
 const env=process.env;const actorId='00000000-0000-4000-8000-000000000001';
 let prisma:any,asaas:any,delivery:any,service:BillingSandbox,sub:any,row:any,dto:any;
 beforeEach(()=>{
  process.env={...env,PLATFORM_OWNER_USER_ID:actorId,BILLING_SANDBOX_TEST_ENABLED:'true',BILLING_DELIVERY_ENABLED:'true',ASAAS_BASE_URL:'https://api-sandbox.asaas.com/v3'};
  const actor={id:actorId,tenantId:'nodus',role:'ADMIN',mustChangePassword:false,tokenVersion:1,passwordHash:bcrypt.hashSync('correct',4)};
  sub={id:'sub',tenantId:'tenant',status:'ACTIVE',deliveryEnabled:true,deliverySettings:{whatsappEnabled:true,phone:'5531999999999',channelId:'channel'}};
  row={id:'wa',state:'SKIPPED',error:'SANDBOX_EMAIL_ONLY',testTarget:null,attemptedAt:null,providerId:null};
  prisma={user:{findUnique:jest.fn(async()=>actor)},subscription:{findUnique:jest.fn(async()=>sub)},channel:{findFirst:jest.fn(async()=>({id:'channel'}))},billingCycle:{findFirst:jest.fn(async()=>({id:'cycle'}))},billingDelivery:{findUnique:jest.fn(async()=>row),findUniqueOrThrow:jest.fn(async()=>row),updateMany:jest.fn(async({data})=>{Object.assign(row,data);return {count:1};}),update:jest.fn(async({data})=>Object.assign(row,data))},auditEvent:{create:jest.fn()},$queryRaw:jest.fn(),$transaction:jest.fn(async fn=>fn(prisma))};
  asaas={createCalendarPayment:jest.fn()};delivery={process:jest.fn(async()=>{if(row.state==='QUEUED')row.state='SENT';})};
  service=new BillingSandbox(prisma,asaas,delivery);dto={currentPassword:'correct',confirmation:'SANDBOX_WHATSAPP',cycleId:'cycle',expectedPhone:'5531999999999',expectedChannelId:'channel'};
 });
 afterEach(()=>{process.env=env;});
 it('authorizes only WhatsApp and reuses the existing test, even on replay',async()=>{
  await service.whatsapp('tenant',actorId,dto);await service.whatsapp('tenant',actorId,dto);
  expect(prisma.billingDelivery.update).toHaveBeenCalledTimes(1);expect(row.state).toBe('SENT');
  expect(asaas.createCalendarPayment).not.toHaveBeenCalled();expect(delivery.process).toHaveBeenCalledWith('wa');
  expect(prisma.billingCycle.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({subscriptionId:'sub',id:'cycle',isTest:true,state:'CREATED',valueCents:500})}));
  expect(prisma.channel.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:'nodus',type:'QR_EVOLUTION',status:'CONNECTED'})}));
 });
 it('rejects production, bad password, missing test and stale settings before queueing',async()=>{
  process.env.ASAAS_BASE_URL='https://api.asaas.com/v3';await expect(service.whatsapp('tenant',actorId,dto)).rejects.toThrow();
  process.env.ASAAS_BASE_URL='https://api-sandbox.asaas.com/v3';
  await expect(service.whatsapp('tenant',actorId,{...dto,currentPassword:'wrong'})).rejects.toThrow('Senha');
  await expect(service.whatsapp('tenant',actorId,{...dto,expectedPhone:'other'})).rejects.toThrow('Salve');
  prisma.billingCycle.findFirst.mockResolvedValue(null);await expect(service.whatsapp('tenant',actorId,dto)).rejects.toThrow('nao encontrada');
  expect(prisma.billingDelivery.update).not.toHaveBeenCalled();expect(delivery.process).not.toHaveBeenCalled();
 });
 it('rejects foreign or disconnected channel and canceled contract',async()=>{
  prisma.channel.findFirst.mockResolvedValue(null);await expect(service.whatsapp('tenant',actorId,dto)).rejects.toThrow('Evolution');
  sub.status='CANCELED';await expect(service.whatsapp('tenant',actorId,dto)).rejects.toThrow('Salve');
  expect(delivery.process).not.toHaveBeenCalled();
 });
 it('preserves uncertain delivery and never authorizes a different recipient for the same test',async()=>{
  row.testTarget={phone:dto.expectedPhone,channelId:dto.expectedChannelId};row.state='REVIEW';
  await service.whatsapp('tenant',actorId,dto);expect(row.state).toBe('REVIEW');expect(prisma.billingDelivery.update).not.toHaveBeenCalled();
  sub.deliverySettings.phone='5531888888888';
  await expect(service.whatsapp('tenant',actorId,{...dto,expectedPhone:sub.deliverySettings.phone})).rejects.toThrow('outro destino');
 });
 it.each([null,{phone:'31999999999',channelId:'old-channel'}])('reauthorizes a never-attempted target rejection with the current confirmed destination',async previous=>{
  row.error='SANDBOX_TARGET_CHANGED';row.testTarget=previous;
  await service.whatsapp('tenant',actorId,dto);await service.whatsapp('tenant',actorId,dto);
  expect(row.testTarget).toEqual({phone:dto.expectedPhone,channelId:dto.expectedChannelId});
  expect(prisma.billingDelivery.updateMany).toHaveBeenCalledTimes(1);
  expect(prisma.billingDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({attemptedAt:null,providerId:null,state:'SKIPPED',error:'SANDBOX_TARGET_CHANGED'})}));
  expect(row.state).toBe('SENT');expect(asaas.createCalendarPayment).not.toHaveBeenCalled();
 });
 it.each([{attemptedAt:new Date()}, {providerId:'provider-message'}])('does not recover a rejection with evidence of an attempt',async evidence=>{
  Object.assign(row,{error:'SANDBOX_TARGET_CHANGED',testTarget:{phone:dto.expectedPhone,channelId:dto.expectedChannelId}},evidence);
  await service.whatsapp('tenant',actorId,dto);
  expect(row.state).toBe('SKIPPED');expect(prisma.billingDelivery.updateMany).not.toHaveBeenCalled();
 });
 it('rejects stale destination before recovery',async()=>{
  row.error='SANDBOX_TARGET_CHANGED';
  await expect(service.whatsapp('tenant',actorId,{...dto,expectedPhone:'31999999999'})).rejects.toThrow('Salve');
  expect(prisma.billingDelivery.updateMany).not.toHaveBeenCalled();
 });

 it('requires explicit owner reconciliation for a previous attempt and preserves its timestamp',async()=>{
  const attemptedAt=new Date('2026-10-21T20:34:09Z');
  Object.assign(row,{error:'SANDBOX_TARGET_CHANGED',attemptedAt,testTarget:{phone:'31999999999',channelId:'channel'}});
  await expect(service.whatsapp('tenant',actorId,dto)).rejects.toThrow('outro destino');
  expect(prisma.billingDelivery.updateMany).not.toHaveBeenCalled();
  await service.whatsapp('tenant',actorId,{...dto,confirmedNotSent:true});
  expect(row.state).toBe('SENT');expect(row.attemptedAt).toEqual(attemptedAt);
  expect(row.testTarget.phone).toBe(dto.expectedPhone);
  expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'billing.sandbox.whatsapp_confirmed_not_sent:cycle'})}));
  await service.whatsapp('tenant',actorId,{...dto,confirmedNotSent:true});
  expect(prisma.billingDelivery.updateMany).toHaveBeenCalledTimes(1);
 });
 it.each(['SENT','SENDING','REVIEW'])('never requeues %s even with confirmation',async state=>{
  Object.assign(row,{state,attemptedAt:new Date(),testTarget:{phone:dto.expectedPhone,channelId:dto.expectedChannelId}});
  await service.whatsapp('tenant',actorId,{...dto,confirmedNotSent:true});
  expect(row.state).toBe(state);expect(prisma.billingDelivery.updateMany).not.toHaveBeenCalled();
 });
 it('never requeues a provider-identified send with confirmation',async()=>{
  Object.assign(row,{error:'SANDBOX_TARGET_CHANGED',providerId:'accepted',testTarget:{phone:dto.expectedPhone,channelId:dto.expectedChannelId}});
  await service.whatsapp('tenant',actorId,{...dto,confirmedNotSent:true});
  expect(row.state).toBe('SKIPPED');expect(prisma.billingDelivery.updateMany).not.toHaveBeenCalled();
 });

});
