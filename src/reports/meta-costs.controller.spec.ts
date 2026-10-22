import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { MetaCostsService } from './meta-costs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

it('restringe custos/configuração a administradores e valida parâmetros antes do serviço',async()=>{
  const costs={get:jest.fn().mockResolvedValue({totalCost:null}),configure:jest.fn().mockResolvedValue({updated:true})};
  const mod=await Test.createTestingModule({controllers:[ReportsController],providers:[{provide:ReportsService,useValue:{}},{provide:MetaCostsService,useValue:costs}]})
    .overrideGuard(JwtAuthGuard).useValue({canActivate(ctx:any){ctx.switchToHttp().getRequest().user={tenantId:'own',role:ctx.switchToHttp().getRequest().headers['x-test-role'] || 'AGENT'};return true;}}).compile();
  const app=mod.createNestApplication();app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();
  const path='/reports/meta-costs',id='11111111-1111-4111-8111-111111111111';
  try {
    await request(app.getHttpServer()).get(`${path}?channelId=${id}&month=2026-10`).expect(403);
    await request(app.getHttpServer()).patch(`${path}/${id}/account`).send({wabaId:'123'}).expect(403);
    expect(costs.get).not.toHaveBeenCalled();expect(costs.configure).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(`${path}?channelId=bad&month=2026-13`).set('x-test-role','ADMIN').expect(400);
    await request(app.getHttpServer()).get(`${path}?channelId=${id}&month=2026-10`).set('x-test-role','ADMIN').expect(200);
    expect(costs.get).toHaveBeenCalledWith('own',id,'2026-10');
    await request(app.getHttpServer()).patch(`${path}/${id}/account`).set('x-test-role','ADMIN').send({wabaId:'123&fields=secret'}).expect(400);
    await request(app.getHttpServer()).patch(`${path}/${id}/account`).set('x-test-role','ADMIN').send({wabaId:'123'}).expect(200);
    expect(costs.configure).toHaveBeenCalledWith('own',id,'123');
  } finally {await app.close();}
});
