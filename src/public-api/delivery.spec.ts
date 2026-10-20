import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { DeliveryService,contextFor } from './delivery.service';
import { DeliveryWorker,classifyDeliveryError } from './delivery.worker';
import { seal,unseal } from '../security/secrets';
import { deliveryPayload } from './delivery-payload';

const pdf={buffer:Buffer.from('%PDF-1.7 boleto'),size:15,mimetype:'application/pdf',originalname:'boleto.pdf'};
const job=(extra:any={})=>({id:'job',tenantId:'t',conversationId:'c',apiKeyHash:'hash',keyHash:'key',fingerprint:'fp',kind:'TEXT',state:'PROCESSING',payload:seal(JSON.stringify({kind:'TEXT',text:'private'}),contextFor('t','job')),payloadBytes:20,attempts:1,nextAttemptAt:new Date(),expiresAt:new Date(Date.now()+86400000),leaseUntil:null,messageId:null,errorCode:null,createdAt:new Date(),updatedAt:new Date(),...extra});
function db(){
 const rows=new Map<string,any>();
 const conversation={id:'c',status:'OPEN',channel:{status:'CONNECTED',type:'OFFICIAL_META',tenant:{status:'ACTIVE'}},contact:{waId:'5531999999999'}};
 const prisma:any={conversation:{findFirst:jest.fn().mockResolvedValue(conversation)},apiKey:{findFirst:jest.fn().mockResolvedValue({id:'key'})},campaignSuppression:{findUnique:jest.fn().mockResolvedValue(null)},message:{findFirst:jest.fn().mockResolvedValue({id:'inbound'})},tenant:{findUnique:jest.fn().mockResolvedValue({status:'ACTIVE'}),update:jest.fn(),updateMany:jest.fn()},$queryRaw:jest.fn(),apiDelivery:{
  findUnique:jest.fn(({where})=>[...rows.values()].find(x=>x.tenantId===where.tenantId_keyHash.tenantId && x.keyHash===where.tenantId_keyHash.keyHash)),
  findUniqueOrThrow:jest.fn(({where})=>rows.get(where.id)),
  findFirst:jest.fn(({where})=>[...rows.values()].find(x=>(!where.id||x.id===where.id)&&(!where.tenantId||x.tenantId===where.tenantId)&&(!where.state||x.state===where.state))),
  aggregate:jest.fn().mockResolvedValue({_sum:{payloadBytes:0},_count:0}),
  create:jest.fn(({data})=>{const r={...data,state:'QUEUED',attempts:0};rows.set(r.id,r);return r;}),
  updateMany:jest.fn(({where,data})=>{let count=0;for(const r of rows.values())if((!where.id||r.id===where.id)&&(!where.tenantId||r.tenantId===where.tenantId)&&(!where.state||r.state===where.state)){Object.assign(r,data);count++;}return {count};}),
  findMany:jest.fn().mockResolvedValue([]),deleteMany:jest.fn(),
 }};prisma.$transaction=jest.fn(fn=>fn(prisma));return {prisma,rows,conversation};
}
describe('Persistent API deliveries',()=>{
 beforeEach(()=>{process.env.API_QUEUE_ENABLED='true';});
 afterEach(()=>{delete process.env.API_QUEUE_ENABLED;});
 it('encrypts contents, replays one protocol and rejects a changed invoice',async()=>{
  const {prisma,rows}=db(),s=new DeliveryService(prisma);
  const dto:any={kind:'TEMPLATE',name:'boleto',language:'pt_BR',parameters:['Cliente']};
  const first=await s.enqueue('t','c','fatura-0001','hash',dto,pdf);
  const repeat=await s.enqueue('t','c','fatura-0001','hash',dto,pdf);
  expect(first.id).toBe(repeat.id);expect(prisma.apiDelivery.create).toHaveBeenCalledTimes(1);
  const row=rows.get(first.id);expect(row.payload).not.toContain('Cliente');expect(unseal(row.payload,contextFor('t',row.id))).toContain('Cliente');
  expect(()=>unseal(row.payload,contextFor('other',row.id))).toThrow();
  await expect(s.enqueue('t','c','fatura-0001','hash',{...dto,parameters:['Outro']},pdf)).rejects.toMatchObject({status:409});
 });
 it('rejects foreign conversation before acceptance and protects read/cancel',async()=>{
  const {prisma,rows}=db(),s=new DeliveryService(prisma);prisma.conversation.findFirst.mockResolvedValue(null);
  await expect(s.enqueue('other','c','fatura-0001','hash',{kind:'TEXT',text:'x'})).rejects.toMatchObject({status:404});
  rows.set('job',job({state:'QUEUED'}));await expect(s.get('other','job')).rejects.toMatchObject({status:404});
  await expect(s.cancel('other','job')).rejects.toMatchObject({status:404});expect(rows.get('job').state).toBe('QUEUED');
 });
 it('rejects quota overflow without accepting an item',async()=>{
  const {prisma}=db(),s=new DeliveryService(prisma);prisma.apiDelivery.aggregate.mockResolvedValue({_sum:{payloadBytes:256*1024*1024},_count:0});
  await expect(s.enqueue('t','c','fatura-0001','hash',{kind:'TEXT',text:'x'})).rejects.toMatchObject({status:429});expect(prisma.apiDelivery.create).not.toHaveBeenCalled();
 });
 it('cancels only waiting jobs and wipes payload',async()=>{
  const {prisma,rows}=db(),s=new DeliveryService(prisma);rows.set('job',job({state:'QUEUED'}));
  const result=await s.cancel('t','job');expect(result.state).toBe('CANCELLED');expect(rows.get('job').payload).toBeNull();
  rows.set('job',job());await expect(s.cancel('t','job')).rejects.toMatchObject({status:409});
 });
 it.each(['revoked','suspended','optout','disconnected'])('rechecks %s at dispatch and does not send',async reason=>{
  const {prisma,rows,conversation}=db();rows.set('job',job());
  if(reason==='revoked')prisma.apiKey.findFirst.mockResolvedValue(null);
  if(reason==='suspended')conversation.channel.tenant.status='SUSPENDED';
  if(reason==='optout')prisma.campaignSuppression.findUnique.mockResolvedValue({});
  if(reason==='disconnected')conversation.channel.status='PENDING';
  const sendMessage=jest.fn();await new DeliveryWorker(prisma,{sendMessage} as any,{} as any).dispatch(rows.get('job'));
  expect(sendMessage).not.toHaveBeenCalled();expect(rows.get('job').state).toBe('CANCELLED');expect(rows.get('job').payload).toBeNull();
 });
 it('records message receipt and erases queued bytes on success',async()=>{
  const {prisma,rows}=db();rows.set('job',job());
  const sendMessage=jest.fn().mockResolvedValue({id:'message'});
  await new DeliveryWorker(prisma,{sendMessage} as any,{} as any).dispatch(rows.get('job'));
  expect(sendMessage).toHaveBeenCalledWith('t','c','private');expect(rows.get('job')).toMatchObject({state:'SENT',messageId:'message',payload:null,payloadBytes:0});
 });
 it('retries an explicit Meta rate refusal with the same persisted payload',async()=>{
  const {prisma,rows}=db();const original=job();rows.set('job',{...original});
  const error=new BadGatewayException({provider:'META',providerStatus:400,providerCode:130429});
  await new DeliveryWorker(prisma,{sendMessage:jest.fn().mockRejectedValue(error)} as any,{} as any).dispatch(original);
  expect(rows.get('job')).toMatchObject({state:'QUEUED',payload:original.payload});expect(rows.get('job').nextAttemptAt.getTime()).toBeGreaterThan(Date.now()+59000);
  expect(prisma.tenant.updateMany).toHaveBeenCalled();
 });
 it('does not repeat an uncertain provider result',async()=>{
  const {prisma,rows}=db();rows.set('job',job());
  const sendMessage=jest.fn().mockRejectedValue(new BadGatewayException('timeout'));
  await new DeliveryWorker(prisma,{sendMessage} as any,{} as any).dispatch(rows.get('job'));
  expect(rows.get('job')).toMatchObject({state:'REVIEW',payload:null,errorCode:'RESULT_UNCERTAIN'});
 });
 it('stale leases become REVIEW, never QUEUED',async()=>{
  const {prisma}=db();await new DeliveryWorker(prisma,{} as any,{} as any).maintenance(new Date());
  expect(prisma.apiDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({state:'PROCESSING'}),data:expect.objectContaining({state:'REVIEW',payload:null})}));
 });
 it('uses a shared tenant clock and conditionally claims before sending',async()=>{
  const {prisma,rows}=db();const pending=job({state:'QUEUED'});rows.set('job',pending);prisma.apiDelivery.findMany.mockResolvedValue([pending]);
  const worker=new DeliveryWorker(prisma,{} as any,{} as any),now=new Date();
  const result=await worker.claim(now);expect(result?.id).toBe('job');
  expect(prisma.tenant.update).toHaveBeenCalledWith({where:{id:'t'},data:{apiDispatchAfter:new Date(now.getTime()+6000)}});
  expect(await worker.claim(now)).toBeNull();
 });
 it('honors persisted cooldown after a restart',async()=>{
  const {prisma,rows}=db();const pending=job({state:'QUEUED'}),later=new Date(Date.now()+60000);rows.set('job',pending);prisma.apiDelivery.findMany.mockResolvedValue([pending]);prisma.tenant.findUnique.mockResolvedValue({status:'ACTIVE',apiDispatchAfter:later});
  expect(await new DeliveryWorker(prisma,{} as any,{} as any).claim(new Date())).toBeNull();expect(rows.get('job').nextAttemptAt).toEqual(later);
 });
});
describe('Payload and provider safety',()=>{
 it('rejects files on text and Excel in a PDF template',()=>{
  expect(()=>deliveryPayload({kind:'TEXT',text:'x'},pdf)).toThrow();
  expect(()=>deliveryPayload({kind:'TEMPLATE',name:'x',language:'pt_BR',parameters:[]},{...pdf,mimetype:'application/vnd.ms-excel'})).toThrow();
 });
 it('distinguishes explicit permanent refusals, upload failures and unknown outcomes',()=>{
  expect(classifyDeliveryError(new ForbiddenException()).state).toBe('FAILED');
  expect(classifyDeliveryError(new BadGatewayException({provider:'META',providerCode:130497,providerStatus:400}))).toMatchObject({state:'FAILED',code:'META_130497'});
  expect(classifyDeliveryError(new BadGatewayException({provider:'META',phase:'UPLOAD'})).state).toBe('QUEUED');
  expect(classifyDeliveryError(new Error()).state).toBe('REVIEW');
 });
});
