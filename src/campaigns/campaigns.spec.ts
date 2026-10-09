import { CampaignsService, renderStep } from './campaigns.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
const dto:any={name:'Invoices',channelId:'channel',requestKey:'invoice-2026-10',scheduledAt:new Date(Date.now()+60000).toISOString(),consentConfirmed:true,stopOnReply:true,recipients:[{phone:'5511999999999',name:'Ana',link:'https://example.com/invoice/123'}],steps:[{delayMinutes:0,type:'TEXT',text:'Oi {{nome}}: {{link}}'},{delayMinutes:1440,type:'TEXT',text:'Lembrete {{nome}}'}]};
function setup(){
 const db:any={auditEvent:{create:jest.fn()},$queryRaw:jest.fn(),tenant:{findUniqueOrThrow:jest.fn().mockResolvedValue({status:'ACTIVE'}),update:jest.fn()},channel:{findFirst:jest.fn().mockResolvedValue({type:'QR_EVOLUTION'})},campaign:{findUnique:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue({id:'campaign'}),findFirst:jest.fn().mockResolvedValue({state:'ACTIVE'}),update:jest.fn()},campaignDelivery:{count:jest.fn().mockResolvedValue(0),createMany:jest.fn(),findFirst:jest.fn(),findUnique:jest.fn(),update:jest.fn(),updateMany:jest.fn()},campaignSuppression:{findUnique:jest.fn().mockResolvedValue(null)},contact:{upsert:jest.fn().mockResolvedValue({id:'contact'})},message:{findFirst:jest.fn().mockResolvedValue(null),findUnique:jest.fn()},apiKey:{findFirst:jest.fn().mockResolvedValue({id:'key'})}};
 db.$transaction=(fn:any)=>fn(db);
 const conversations:any={start:jest.fn().mockResolvedValue({id:'conversation'}),sendMessage:jest.fn().mockResolvedValue({id:'message'}),sendTemplate:jest.fn().mockResolvedValue({id:'template'})};
 return {db,conversations,service:new CampaignsService(db,conversations)};
}
const job:any={id:'job',campaignId:'campaign',contactId:'contact',step:0,campaign:{tenantId:'tenant',channelId:'channel',stopOnReply:true,createdAt:new Date(0)},contact:{waId:'5511999999999'},payload:{type:'TEXT',text:'Invoice link'}};
describe('Campaign queue boundaries',()=>{
 it('personalizes each payload, persists schedule and never sends during creation',async()=>{
  const {service,db,conversations}=setup();await service.create('tenant',dto);
  const rows=db.campaignDelivery.createMany.mock.calls[0][0].data;
  expect(rows[0].payload.text).toBe('Oi Ana: https://example.com/invoice/123\n\nPara não receber mais campanhas, responda SAIR.');
  expect(rows[1].dueAt.getTime()-rows[0].dueAt.getTime()).toBe(86400000);
  expect(conversations.sendMessage).not.toHaveBeenCalled();
 });
 it('rejects missing variables, consent, duplicate recipients, invalid step ordering',async()=>{
  expect(()=>renderStep(dto.steps[0],{phone:'5511999999999'})).toThrow(BadRequestException);
  const {service,db}=setup();
  for(const invalid of [{...dto,consentConfirmed:false},{...dto,recipients:[...dto.recipients,...dto.recipients]},{...dto,steps:[dto.steps[1],dto.steps[0]]}]) await expect(service.create('tenant',invalid)).rejects.toBeInstanceOf(BadRequestException);
  expect(db.campaign.create).not.toHaveBeenCalled();
 });
 it('requires owned channels and approved template format for Meta',async()=>{
  const {service,db}=setup();db.channel.findFirst.mockResolvedValue(null);
  await expect(service.create('tenant',dto)).rejects.toBeInstanceOf(NotFoundException);
  db.channel.findFirst.mockResolvedValue({type:'OFFICIAL_META'});
  await expect(service.create('tenant',dto)).rejects.toBeInstanceOf(BadRequestException);
  expect(db.campaign.create).not.toHaveBeenCalled();
 });
 it('deduplicates exact retries and rejects reusing the key for other content',async()=>{
  const {service,db}=setup();await service.create('tenant',dto);
  const saved=db.campaign.create.mock.calls[0][0].data;db.campaign.findUnique.mockResolvedValue({id:'campaign',...saved});
  expect(await service.create('tenant',dto)).toEqual({id:'campaign',reused:true});
  await expect(service.create('tenant',{...dto,name:'Changed'})).rejects.toBeInstanceOf(ConflictException);
  expect(db.campaign.create).toHaveBeenCalledTimes(1);
 });
 it.each(['reply','optout','revoked','previous-failed'])('skips %s without sending',async reason=>{
  const {service,db,conversations}=setup();const j=structuredClone(job);db.campaignDelivery.findFirst.mockResolvedValue(j);
  if(reason==='reply')db.message.findFirst.mockResolvedValue({id:'reply'});
  if(reason==='optout')db.campaignSuppression.findUnique.mockResolvedValue({});
  if(reason==='revoked'){j.campaign.sourceKeyHash='hash';db.apiKey.findFirst.mockResolvedValue(null);}
  if(reason==='previous-failed'){j.step=1;db.campaignDelivery.findUnique.mockResolvedValue({status:'UNKNOWN'});}
  expect(await service.claim('job','tenant')).toBe(null);
  expect(db.campaignDelivery.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'SKIPPED'})}));
  expect(conversations.sendMessage).not.toHaveBeenCalled();
 });
 it('does not claim suspended tenants or a slot reserved by another worker',async()=>{
  const {service,db}=setup();
  for(const tenant of [{status:'SUSPENDED'},{status:'ACTIVE',dispatchClock:new Date(Date.now()+60000)}]){
   db.tenant.findUniqueOrThrow.mockResolvedValue(tenant);expect(await service.claim('job','tenant')).toBe(null);
  }
  expect(db.campaignDelivery.update).not.toHaveBeenCalled();
 });
 it('waits for the previous step and does not retry an uncertain provider result',async()=>{
  const {service,db,conversations}=setup();db.campaignDelivery.findFirst.mockResolvedValue({...job,step:1});db.campaignDelivery.findUnique.mockResolvedValue({status:'SENDING'});
  expect(await service.claim('job','tenant')).toBe(null);
  db.campaignDelivery.findFirst.mockResolvedValue(job);conversations.sendMessage.mockRejectedValue(new Error('timeout'));
  await service.deliver(job);
  expect(conversations.sendMessage).toHaveBeenCalledTimes(1);
  expect(db.campaignDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'UNKNOWN',payload:{}})}));
 });
 it('honors cancellation before dispatch and persists sent message reference',async()=>{
  const {service,db,conversations}=setup();db.campaignDelivery.findFirst.mockResolvedValue(null);await service.deliver(job);expect(conversations.start).not.toHaveBeenCalled();
  db.campaignDelivery.findFirst.mockResolvedValue(job);await service.deliver(job);
  expect(db.campaignDelivery.update).toHaveBeenCalledWith({where:{id:'job'},data:expect.objectContaining({status:'SENT',messageId:'message',payload:{}})});
 });
 it('respects an opt-out received after claim, immediately before provider dispatch',async()=>{
  const {service,db,conversations}=setup();db.campaignDelivery.findFirst.mockResolvedValue(job);
  db.campaignSuppression.findUnique.mockResolvedValue({phoneHash:'blocked'});
  await service.deliver(job);
  expect(conversations.sendMessage).not.toHaveBeenCalled();expect(conversations.sendTemplate).not.toHaveBeenCalled();
  expect(db.campaignDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'job',status:'SENDING'},data:expect.objectContaining({status:'SKIPPED',payload:{}})}));
 });
 it('cancels only queued deliveries and rejects foreign campaign actions',async()=>{
  const {service,db}=setup();await service.state('tenant','campaign','CANCELLED');
  expect(db.campaignDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{campaignId:'campaign',status:'QUEUED'}}));
  db.campaign.findFirst.mockResolvedValue(null);await expect(service.state('tenant','foreign','PAUSED')).rejects.toBeInstanceOf(NotFoundException);
 });
});
