import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request = require('supertest');
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Workspace HTTP authorization', () => {
  let app:any, token:string, role='ADMIN', status='ACTIVE';
  const prisma:any = {
    user:{ findFirst:jest.fn(async()=>({role,tokenVersion:0,mustChangePassword:false})) },
    tenant:{ findUnique:jest.fn(async()=>({status})), findUniqueOrThrow:jest.fn().mockResolvedValue({workspaceSettings:{}}) },
    rateBucket:{ upsert:jest.fn().mockResolvedValue({hits:1}) },
    subscription:{ findUnique:jest.fn().mockResolvedValue(null) },
    conversation:{ findFirst:jest.fn().mockResolvedValue(null) },
  };
  beforeAll(async()=>{
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(prisma).compile();
    token=module.get(JwtService).sign({sub:'user',tenantId:'own',ver:0});
    app=module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();
  });
  beforeEach(()=>{role='ADMIN';status='ACTIVE';});
  afterAll(async()=>app.close());
  it('requires a session',async()=>{await request(app.getHttpServer()).get('/workspace').expect(401);});
  it.each([['get','/campaigns'],['post','/campaigns'],['patch','/users/11111111-1111-4111-8111-111111111111/role'],['patch','/workspace'],['patch','/workspace/users/foreign/availability'],['delete','/users/11111111-1111-4111-8111-111111111111'],['get','/users/limits'],['delete','/channels/foreign'],['post','/channels/foreign/restart'],['get','/billing/payments']])('rejects agent %s %s',async(method,path)=>{
    role='AGENT';await (request(app.getHttpServer()) as any)[method](path).auth(token,{type:'bearer'}).send({}).expect(403);
  });
  it('permits suspended admin billing but keeps conversations blocked',async()=>{
    status='SUSPENDED';
    await request(app.getHttpServer()).get('/billing/payments').auth(token,{type:'bearer'}).expect(200,{data:[],hasMore:false,totalCount:0});
    await request(app.getHttpServer()).get('/conversations').auth(token,{type:'bearer'}).expect(403);
  });
  it('validates required schedule and rejects unknown fields',async()=>{
    await request(app.getHttpServer()).patch('/workspace').auth(token,{type:'bearer'}).send({timezone:'UTC',awayMessage:'',stages:[],probe:true}).expect(400);
  });
  it('returns 404 for a foreign conversation deletion',async()=>{
    prisma.$transaction=(fn:any)=>fn(prisma);
    await request(app.getHttpServer()).delete('/conversations/foreign').auth(token,{type:'bearer'}).expect(404);
  });
});
