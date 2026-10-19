import { Body, Controller, INestApplication, Post, Req, UploadedFile, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileInterceptor } from '@nestjs/platform-express';
import request = require('supertest');
import { AttachmentDto, AttachmentFile, AttachmentUploadGate, attachmentUploadOptions } from './attachment-upload';
import { PrismaService } from '../prisma/prisma.service';
import { RateGuard } from '../security/rate.guard';
@Controller('test')
class UploadController {
  @Post(':id')
  @UseInterceptors(AttachmentUploadGate,FileInterceptor('file',attachmentUploadOptions))
  upload(@UploadedFile() file:AttachmentFile,@Body() dto:AttachmentDto) { return {size:file?.size,caption:dto.caption}; }
}
describe('Limites multipart antes do envio',()=>{
 let app:INestApplication, owned:jest.Mock;
 beforeAll(async()=>{
  owned=jest.fn().mockResolvedValue({id:'c'});
  const module=await Test.createTestingModule({controllers:[UploadController],providers:[AttachmentUploadGate,{provide:PrismaService,useValue:{conversation:{findFirst:owned}}},{provide:RateGuard,useValue:{consume:jest.fn()}}]}).compile();
  app=module.createNestApplication();app.use((req:any,_res:any,next:()=>void)=>{req.user={tenantId:'t'};next();});
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();
 });
 afterAll(async()=>{await app.close();});
 it('aceita um arquivo e legenda',async()=>{
  const response=await request(app.getHttpServer()).post('/test/c').field('caption','teste').attach('file',Buffer.from('%PDF-1.7'),{filename:'a.pdf',contentType:'application/pdf'});
  expect(response.status).toBe(201);expect(response.body.caption).toBe('teste');
 });
 it('nega conversa fora da empresa',async()=>{
  owned.mockResolvedValueOnce(null);
  await request(app.getHttpServer()).post('/test/c').attach('file',Buffer.from('%PDF-1.7'),{filename:'a.pdf',contentType:'application/pdf'}).expect(404);
 });
 it('rejeita tipo, campo extra, legenda longa e tamanho excessivo',async()=>{
  await request(app.getHttpServer()).post('/test/c').attach('file',Buffer.from('bad'),{filename:'a.html',contentType:'text/html'}).expect(415);
  await request(app.getHttpServer()).post('/test/c').field('probe','bad').attach('file',Buffer.from('%PDF-1.7'),{filename:'a.pdf',contentType:'application/pdf'}).expect(400);
  await request(app.getHttpServer()).post('/test/c').field('caption','a'.repeat(1025)).attach('file',Buffer.from('%PDF-1.7'),{filename:'a.pdf',contentType:'application/pdf'}).expect(400);
  await request(app.getHttpServer()).post('/test/c').attach('file',Buffer.alloc(10*1024*1024+1),{filename:'a.pdf',contentType:'application/pdf'}).expect(413);
 });
 it('libera capacidade depois dos erros anteriores',async()=>{
  await request(app.getHttpServer()).post('/test/c').attach('file',Buffer.from('%PDF-1.7'),{filename:'a.pdf',contentType:'application/pdf'}).expect(201);
 });
});
