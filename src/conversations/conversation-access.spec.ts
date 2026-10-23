import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationNotesController, ConversationNotesService } from './conversation-notes';
import { ConversationAccessGuard } from './conversation-access.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ContactPhotosService } from './contact-photos.service';
import { MessageMediaService } from './message-media.service';
import { AttachmentSendService } from './attachment-send.service';
import { AttachmentUploadGate } from './attachment-upload';

const agent = {userId:'agent-a',tenantId:'company-a',role:'AGENT',email:'a@example.com'};

describe('Conversation HTTP access boundary',()=>{
  let app:any, viewer:any, owner:string|null, tenant:string;
  const handlers:any={};
  const notes={list:jest.fn().mockResolvedValue({items:[]}),create:jest.fn()};
  const photos={forConversation:jest.fn()};
  const media={download:jest.fn()};
  const sender={send:jest.fn()};
  const db={conversation:{findFirst:jest.fn(async({where}:any)=>{
    if(where.channel.tenantId!==tenant)return null;
    if(where.OR && !where.OR.some((rule:any)=>rule.assignedUserId===owner))return null;
    return {id:'conversation'};
  })}};
  beforeAll(async()=>{
    for(const key of ['start','visibleAssignments','assign','sendTemplate','renameContact','setStage','setDepartment','remove','listForTenant','listMessages','sendMessage','updateStatus']) handlers[key]=jest.fn().mockResolvedValue([]);
    const module=await Test.createTestingModule({controllers:[ConversationsController,ConversationNotesController],providers:[
      ConversationAccessGuard,{provide:PrismaService,useValue:db},{provide:ConversationsService,useValue:handlers},
      {provide:ConversationNotesService,useValue:notes},{provide:ContactPhotosService,useValue:photos},
      {provide:MessageMediaService,useValue:media},{provide:AttachmentSendService,useValue:sender},
    ]}).overrideGuard(JwtAuthGuard).useValue({canActivate:(ctx:any)=>{ctx.switchToHttp().getRequest().user=viewer;return true;}})
      .overrideInterceptor(AttachmentUploadGate).useValue({intercept:(_:any,next:any)=>next.handle()}).compile();
    app=module.createNestApplication();app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();
  });
  beforeEach(()=>{jest.clearAllMocks();viewer={...agent};owner='agent-b';tenant='company-a';});
  afterAll(async()=>app.close());
  it.each([
    ['get','messages'],['get','messages/message/media'],['get','photo'],['get','notes'],['post','notes'],
    ['post','messages'],['post','attachments'],['post','template'],['post','transfer'],
    ['patch','contact'],['patch','stage'],['patch','department'],['patch','status'],['patch','assign'],['delete',''],
  ])('denies another operator via %s %s before any handler or upload',async(method,suffix)=>{
    await (request(app.getHttpServer()) as any)[method](`/conversations/conversation${suffix?'/'+suffix:''}`).send({}).expect(404);
    for(const fn of [...Object.values(handlers),...Object.values(notes),...Object.values(photos),...Object.values(media),...Object.values(sender)])expect(fn).not.toHaveBeenCalled();
  });
  it.each([null,'agent-a'])('allows queue or own conversation (%s)',async assigned=>{
    owner=assigned;await request(app.getHttpServer()).get('/conversations/conversation/messages').expect(200);
    expect(handlers.listMessages).toHaveBeenCalledWith('company-a','conversation',undefined);
  });
  it('lets an admin read another operator and notes in their company',async()=>{
    viewer.role='ADMIN';await request(app.getHttpServer()).get('/conversations/conversation/messages').expect(200);
    await request(app.getHttpServer()).get('/conversations/conversation/notes').expect(200);
  });
  it('does not let an admin cross the tenant boundary',async()=>{
    viewer.role='ADMIN';tenant='company-b';await request(app.getHttpServer()).get('/conversations/conversation/messages').expect(404);
    expect(handlers.listMessages).not.toHaveBeenCalled();
  });
  it('passes the viewer to list and creation so collection routes are scoped',async()=>{
    await request(app.getHttpServer()).get('/conversations?mine=true').expect(200);
    expect(handlers.listForTenant).toHaveBeenCalledWith('company-a',expect.objectContaining({viewer,assignedUserId:'agent-a'}));
  });
  it('passes caller and destination to transfer',async()=>{
    owner='agent-a';const target='11111111-1111-4111-8111-111111111111';
    await request(app.getHttpServer()).post('/conversations/conversation/transfer').send({userId:target}).expect(201);
    expect(handlers.assign).toHaveBeenCalledWith('company-a','conversation',target,viewer,true);
  });
  it('validates transfer and bounds visibility batches',async()=>{
    owner='agent-a';await request(app.getHttpServer()).post('/conversations/conversation/transfer').send({}).expect(400);
    await request(app.getHttpServer()).post('/conversations/visibility').send({ids:Array(501).fill('11111111-1111-4111-8111-111111111111')}).expect(400);
    expect(handlers.visibleAssignments).not.toHaveBeenCalled();
  });
});
