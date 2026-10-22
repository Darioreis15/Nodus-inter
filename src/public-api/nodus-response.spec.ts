import { nodusResponse } from './nodus-response';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PublicChannelsController } from './public-conversations.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyGuard } from './guards/api-key.guard';
it('maps channel types without changing customer content or original objects',()=>{
 const input={channel:{type:'QR_EVOLUTION'},lastMessage:{body:'Evolution QR_EVOLUTION',raw:{secret:'provider'},createdAt:new Date()},contact:{name:'Evolution'}};
 const out=nodusResponse(input);
 expect(out.channel.type).toBe('QR_NODUS');expect(out.lastMessage.body).toBe(input.lastMessage.body);
 expect(out.lastMessage.raw).toBeUndefined();expect(out.lastMessage.createdAt).toBe(input.lastMessage.createdAt);
 expect(out.contact.name).toBe('Evolution');expect(input.channel.type).toBe('QR_EVOLUTION');
 expect(nodusResponse([{type:'OFFICIAL_META'}])).toEqual([{type:'OFFICIAL_META'}]);
});
describe('public versions',()=>{
 let app:INestApplication;const findMany=jest.fn().mockResolvedValue([{id:'channel',name:'Nodus',type:'QR_EVOLUTION',status:'CONNECTED'}]);
 beforeAll(async()=>{
  const mod=await Test.createTestingModule({controllers:[PublicChannelsController],providers:[{provide:PrismaService,useValue:{channel:{findMany}}}]}).overrideGuard(ApiKeyGuard).useValue({canActivate:(ctx:any)=>{const req=ctx.switchToHttp().getRequest();req.apiTenantId='tenant';return req.headers.authorization==='Bearer test';}}).compile();
  app=mod.createNestApplication();await app.init();
 });
 afterAll(()=>app.close());
 it('keeps v1 and exposes Nodus in v2 under the same guard and tenant scope',async()=>{
  await request(app.getHttpServer()).get('/public/v1/channels').set('Authorization','Bearer test').expect(200).expect(r=>expect(r.body[0].type).toBe('QR_EVOLUTION'));
  await request(app.getHttpServer()).get('/public/v2/channels').set('Authorization','Bearer test').expect(200).expect(r=>expect(r.body[0].type).toBe('QR_NODUS'));
  expect(findMany).toHaveBeenLastCalledWith({where:{tenantId:'tenant'},select:{id:true,name:true,type:true,status:true}});
  await request(app.getHttpServer()).get('/public/v2/channels').expect(403);
 });
});
