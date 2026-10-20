import { INestApplication,ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DeliveryController } from './delivery.controller';
import { DeliveryInput } from './delivery-input';
import { DeliveryService } from './delivery.service';
import { PublicConversationsController } from './public-conversations.controller';
import { PublicTemplatesService } from './public-templates.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RateGuard } from '../security/rate.guard';
describe('Delivery HTTP contracts',()=>{
 let app:INestApplication,enqueue:jest.Mock,send:jest.Mock,owned:jest.Mock,rate:jest.Mock;
 beforeAll(async()=>{
  process.env.API_QUEUE_ENABLED='true';enqueue=jest.fn().mockResolvedValue({id:'job',state:'QUEUED'});send=jest.fn().mockResolvedValue({id:'message'});owned=jest.fn().mockResolvedValue({id:'c'});rate=jest.fn();
  const mod=await Test.createTestingModule({controllers:[DeliveryController,PublicConversationsController],providers:[DeliveryInput,{provide:PrismaService,useValue:{conversation:{findFirst:owned}}},{provide:RateGuard,useValue:{consume:rate}},{provide:DeliveryService,useValue:{enqueue}},{provide:PublicTemplatesService,useValue:{send}},{provide:ConversationsService,useValue:{}}]}).overrideGuard(ApiKeyGuard).useValue({canActivate:(ctx:any)=>{const req=ctx.switchToHttp().getRequest();req.apiTenantId='tenant';req.apiKeyHash='hashed-key';return true;}}).compile();
  app=mod.createNestApplication();app.useLogger(false);app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();
 });
 afterAll(async()=>{delete process.env.API_QUEUE_ENABLED;await app.close();});
 beforeEach(()=>{enqueue.mockClear();send.mockClear();});
 const queue=()=>request(app.getHttpServer()).post('/public/v1/conversations/c/deliveries').set('Idempotency-Key','fatura-123');
 it('accepts JSON text and returns 202 with the source key hash',async()=>{
  await queue().send({kind:'TEXT',text:'Teste'}).expect(202);expect(enqueue).toHaveBeenCalledWith('tenant','c','fatura-123','hashed-key',expect.objectContaining({text:'Teste'}),undefined);
 });
 it('parses multipart template parameters as an array',async()=>{
  await queue().field('kind','TEMPLATE').field('name','boleto').field('language','pt_BR').field('parameters','["Cliente","99,00"]').attach('file',Buffer.from('%PDF-1.7'),{filename:'boleto.pdf',contentType:'application/pdf'}).expect(202);
  expect(enqueue.mock.calls[0][4].parameters).toEqual(['Cliente','99,00']);expect(enqueue.mock.calls[0][5].mimetype).toBe('application/pdf');
 });
 it('supports PDF at the existing template route and preserves JSON clients',async()=>{
  await request(app.getHttpServer()).post('/public/v1/conversations/c/template').set('Idempotency-Key','fatura-123').field('name','boleto').field('language','pt_BR').field('parameters','["Cliente"]').attach('file',Buffer.from('%PDF-1.7'),{filename:'boleto.pdf',contentType:'application/pdf'}).expect(201);
  expect(send.mock.calls[0][2].parameters).toEqual(['Cliente']);
  await request(app.getHttpServer()).post('/public/v1/conversations/c/template').send({name:'hello_world',language:'en_US',parameters:[]}).expect(201);
 });
 it('requires keys, rejects malformed parameters and unknown fields',async()=>{
  await request(app.getHttpServer()).post('/public/v1/conversations/c/deliveries').send({kind:'TEXT',text:'a'}).expect(400);
  await queue().field('kind','TEMPLATE').field('parameters','bad').expect(400);
  await queue().send({kind:'TEXT',text:'a',fileUrl:'https://bad.example'}).expect(400);
  expect(enqueue).not.toHaveBeenCalled();
 });
 it('checks ownership before reading a file and releases capacity after parser errors',async()=>{
  owned.mockResolvedValueOnce(null);
  await queue().field('kind','ATTACHMENT').attach('file',Buffer.from('%PDF-1.7'),{filename:'x.pdf',contentType:'application/pdf'}).expect(404);
  for(let n=0;n<3;n++)await queue().field('kind','ATTACHMENT').attach('file',Buffer.from('x'),{filename:'x.html',contentType:'text/html'}).expect(415);
  await queue().field('kind','ATTACHMENT').attach('file',Buffer.from('%PDF-1.7'),{filename:'x.pdf',contentType:'application/pdf'}).expect(202);
 });
});
