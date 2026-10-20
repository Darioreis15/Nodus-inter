import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PublicAttachmentsController, PublicAttachmentsService } from './public-attachments';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateGuard } from '../security/rate.guard';
import { AttachmentSendService } from '../conversations/attachment-send.service';
import { AttachmentUploadGate } from '../conversations/attachment-upload';
describe('Public attachment API',()=>{
 let app:INestApplication,send:jest.Mock,records:Map<string,any>,prisma:any,tenantStatus:string;
 beforeAll(async()=>{
  records=new Map();tenantStatus='ACTIVE';send=jest.fn();
  prisma={tenant:{findUnique:jest.fn(()=>({status:tenantStatus}))},conversation:{findFirst:jest.fn(({where})=>where.id==='foreign'?null:{id:where.id})},publicAttachmentRequest:{
   create:jest.fn(({data})=>{const key=data.tenantId+data.keyHash;if(records.has(key))return Promise.reject({code:'P2002'});const row={...data,id:key,state:'SENDING'};records.set(key,row);return row;}),
   findUniqueOrThrow:jest.fn(({where})=>records.get(where.tenantId_keyHash.tenantId+where.tenantId_keyHash.keyHash)),
   update:jest.fn(({where,data})=>Object.assign(records.get(where.id),data)),
   updateMany:jest.fn(({where,data})=>{const row=records.get(where.id);if(row.state===where.state)Object.assign(row,data);return {count:1};}),
  }};
  const mod=await Test.createTestingModule({controllers:[PublicAttachmentsController],providers:[PublicAttachmentsService,ApiKeyGuard,AttachmentUploadGate,{provide:PrismaService,useValue:prisma},{provide:ApiKeysService,useValue:{resolveTenantId:jest.fn(key=>key==='valid'?'tenant':key==='other'?'tenant2':null)}},{provide:RateGuard,useValue:{consume:jest.fn()}},{provide:AttachmentSendService,useValue:{send}}]}).compile();
  app=mod.createNestApplication();app.useLogger(false);app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();
 });
 beforeEach(()=>{records.clear();send.mockReset().mockResolvedValue({id:'message',status:'SENT',body:'private',toNumber:'private'});tenantStatus='ACTIVE';});
 afterAll(async()=>{await app.close();});
 const upload=(key='same-key-001',auth='valid',id='conversation',body='%PDF-1.7')=>request(app.getHttpServer()).post(`/public/v1/conversations/${id}/attachments`).set('Authorization',`Bearer ${auth}`).set('Idempotency-Key',key).attach('file',Buffer.from(body),{filename:'boleto.pdf',contentType:'application/pdf'});
 it('replays a minimal receipt and sends only once',async()=>{const first=await upload().expect(201),second=await upload().expect(201);expect(second.body).toEqual(first.body);expect(first.body).toEqual({id:'message',conversationId:'conversation',status:'SENT'});expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toBe('tenant');expect(JSON.stringify([...records.values()])).not.toContain('private');});
 it('rejects revoked keys, suspended tenants and foreign conversations before sending',async()=>{await upload('same-key-001','revoked').expect(401);await upload('same-key-001','valid','foreign').expect(404);tenantStatus='SUSPENDED';await upload().expect(403);expect(send).not.toHaveBeenCalled();});
 it('requires an idempotency key, rejects a changed payload and isolates tenants',async()=>{await upload('').expect(400);await upload().expect(201);await upload('same-key-001','valid','conversation','changed').expect(409);await upload('same-key-001','other').expect(201);expect(send).toHaveBeenCalledTimes(2);});
 it('never repeats an uncertain delivery',async()=>{send.mockRejectedValueOnce(new Error('provider timeout'));await upload().expect(500);await upload().expect(409);expect(send).toHaveBeenCalledTimes(1);expect([...records.values()][0].state).toBe('REVIEW');});
 it('reserves before concurrent requests can send',async()=>{let release:any;send.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({id:'message',status:'SENT'});}));const first=upload().then(r=>r);while(!release)await new Promise(resolve=>setImmediate(resolve));await upload().expect(409);release();expect((await first).status).toBe(201);expect(send).toHaveBeenCalledTimes(1);});
});
