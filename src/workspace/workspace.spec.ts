import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { withinHours } from './workspace.dto';
import { WorkspaceController } from './workspace.controller';
import { ConversationsService } from '../conversations/conversations.service';
import { ChannelsService } from '../channels/channels.service';
import { BillingService } from '../billing/billing.service';
import { PasswordResetController } from '../auth/password-reset.controller';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';

const unused: any = {};

describe('Customer workspace boundaries', () => {
  const weekday = { enabled: true, days: [1], start: '08:00', end: '18:00' };
  it('uses tenant timezone and excludes the closing instant', () => {
    expect(withinHours(weekday, 'America/Sao_Paulo', new Date('2026-10-05T11:00:00Z'))).toBe(true);
    expect(withinHours(weekday, 'America/Sao_Paulo', new Date('2026-10-05T21:00:00Z'))).toBe(false);
    expect(withinHours(weekday, 'America/Sao_Paulo', new Date('2026-10-04T15:00:00Z'))).toBe(false);
  });
  it('carries an overnight shift into the following day', () => {
    const shift = { ...weekday, start: '22:00', end: '06:00' };
    expect(withinHours(shift, 'UTC', new Date('2026-10-06T03:00:00Z'))).toBe(true);
    expect(withinHours(shift, 'UTC', new Date('2026-10-05T03:00:00Z'))).toBe(false);
  });
  it('rejects assigning a stage to a foreign operator before saving', async () => {
    const db: any = { user: { count: jest.fn().mockResolvedValue(0) }, tenant: { update: jest.fn(), findUniqueOrThrow:jest.fn().mockResolvedValue({workspaceSettings:{}}) } };
    db.$transaction = (fn:any) => fn(db); db.$queryRaw = jest.fn();
    const controller = new WorkspaceController(db);
    await expect(controller.save({ tenantId:'own' } as any, { timezone:'UTC', businessHours:weekday, awayMessage:'', stages:[{ id:'stage', name:'Sales', keyword:'sales', message:'', userId:'foreign' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tenant.update).not.toHaveBeenCalled();
  });
  it('cannot delete conversations from another tenant', async () => {
    const db: any = { conversation: { findFirst:jest.fn().mockResolvedValue(null), delete:jest.fn() } }; db.$transaction = (f:any) => f(db);
    const service = new ConversationsService(db, unused, unused, unused, unused);
    await expect(service.remove('own', 'foreign', 'actor')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where:{ id:'foreign', channel:{ tenantId:'own' } } }));
    expect(db.conversation.delete).not.toHaveBeenCalled();
  });
  it.each([{ type:'OFFICIAL_META', held:false }, { type:'QR_EVOLUTION', held:true }])('protects deletion %p', async c => {
    const db: any = { conversation: { findFirst:jest.fn().mockResolvedValue({ channel:{ type:c.type }, contact:{ legalHold:c.held } }), delete:jest.fn() } }; db.$transaction = (f:any) => f(db);
    await expect(new ConversationsService(db, unused, unused, unused, unused).remove('own','c','a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.conversation.delete).not.toHaveBeenCalled();
  });
  it('does not contact Evolution when the channel is not owned', async () => {
    const db:any = { channel:{ findFirst:jest.fn().mockResolvedValue(null) } }, evo:any = { restart:jest.fn() };
    await expect(new ChannelsService(db,evo).connectionAction('own','foreign','restart')).rejects.toBeInstanceOf(NotFoundException);
    expect(evo.restart).not.toHaveBeenCalled();
  });
  it('fetches invoices only for the customer linked to the current tenant', async () => {
    const db:any = { subscription:{ findUnique:jest.fn().mockResolvedValue({ asaasCustomerId:'own-customer' }) } };
    const asaas:any = { listCustomerPayments:jest.fn().mockResolvedValue({ data:[], hasMore:false, totalCount:0 }) };
    await new BillingService(db,asaas).payments('own',50);
    expect(db.subscription.findUnique).toHaveBeenCalledWith({ where:{ tenantId:'own' } });
    expect(asaas.listCustomerPayments).toHaveBeenCalledWith('own-customer',50);
  });
  it('records the actual resolver, not the assigned operator', async () => {
    const db:any = { conversation:{ findFirst:jest.fn().mockResolvedValue({ assignedUserId:'different' }), update:jest.fn().mockResolvedValue({}) }, user:{ findFirst:jest.fn().mockResolvedValue({ id:'actor', name:'Ana' }) }, auditEvent:{ create:jest.fn() } }; db.$transaction = (f:any) => f(db);
    await new ConversationsService(db,unused,unused,unused,unused).updateStatus('own','c','RESOLVED','actor');
    expect(db.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data:expect.objectContaining({ resolvedById:'actor', resolvedByName:'Ana', resolvedAt:expect.any(Date) }) }));
  });
  it('refuses Meta free text outside the response window before sending', async () => {
    const db:any = { conversation:{ findFirst:jest.fn().mockResolvedValue({ channel:{ type:'OFFICIAL_META' }, contact:{ waId:'5511999999999' } }) }, message:{ findFirst:jest.fn().mockResolvedValue(null) } };
    const meta:any = { sendText:jest.fn() };
    await expect(new ConversationsService(db,unused,unused,meta,unused).sendMessage('own','c','hello')).rejects.toBeInstanceOf(ForbiddenException);
    expect(meta.sendText).not.toHaveBeenCalled();
  });
});

describe('Password recovery', () => {
  const token = 'a'.repeat(64);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  function db(expiresAt = new Date(Date.now()+60000)) {
    const store:any = { passwordReset:{ findUnique:jest.fn().mockResolvedValue({ tokenHash,userId:'user',expiresAt }), deleteMany:jest.fn().mockResolvedValue({ count:1 }) }, user:{ update:jest.fn() } }; store.$transaction = (f:any) => f(store); return store;
  }
  it('hashes the new password and revokes existing sessions', async () => {
    const store = db();
    await new PasswordResetController(store).reset({ token,newPassword:'A-new-password-123' });
    expect(store.passwordReset.findUnique).toHaveBeenCalledWith({ where:{ tokenHash } });
    const data = store.user.update.mock.calls[0][0].data;
    expect(await bcrypt.compare('A-new-password-123',data.passwordHash)).toBe(true);
    expect(data.tokenVersion).toEqual({ increment:1 });
  });
  it('rejects an expired link without updating the password', async () => {
    const store = db(new Date(0));
    await expect(new PasswordResetController(store).reset({ token,newPassword:'A-new-password-123' })).rejects.toBeInstanceOf(BadRequestException);
    expect(store.user.update).not.toHaveBeenCalled();
  });
  it('rejects a link already consumed by a concurrent request', async () => {
    const store = db(); store.passwordReset.deleteMany.mockResolvedValue({ count:0 });
    await expect(new PasswordResetController(store).reset({ token,newPassword:'A-new-password-123' })).rejects.toBeInstanceOf(BadRequestException);
    expect(store.user.update).not.toHaveBeenCalled();
  });
  it('does not expose whether a recipient is registered', async () => {
    const previous = process.env; const fetchOld = global.fetch;
    process.env = { ...previous, RESEND_API_KEY:'test', MAIL_FROM:'test@example.com', FRONTEND_URL:'https://app.example.com' };
    global.fetch = jest.fn().mockResolvedValue({ ok:true });
    try {
      const store:any = { user:{ findUnique:jest.fn().mockResolvedValue(null) }, passwordReset:{ create:jest.fn(),deleteMany:jest.fn() } };
      const controller = new PasswordResetController(store);
      const missing = await controller.forgot({ email:'unknown@example.com' });
      expect(global.fetch).not.toHaveBeenCalled();
      store.user.findUnique.mockResolvedValue({ id:'u',email:'known@example.com' });
      expect(await controller.forgot({ email:'known@example.com' })).toEqual(missing);
      expect(store.passwordReset.create.mock.calls[0][0].data).not.toHaveProperty('token');
      expect(store.passwordReset.create.mock.calls[0][0].data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    } finally { process.env=previous;global.fetch=fetchOld; }
  });
});

describe('Inbound routing and names', () => {
  const channel:any = { id:'channel',tenantId:'tenant',externalId:'instance',type:'QR_EVOLUTION',autoReplyEnabled:true,autoReplyMessage:'Welcome' };
  const stage={id:'stage',name:'Sales',keyword:'sales',message:'Sales team will reply.',userId:'operator'};
  function setup(available:boolean, hours:any={enabled:false}, tenantStatus='ACTIVE') {
    const conversation:any={id:'conv',status:'OPEN',funnelStage:null};
    const db:any={
      campaignDelivery:{updateMany:jest.fn()}, campaignSuppression:{upsert:jest.fn()},
      $queryRaw:jest.fn(), contact:{upsert:jest.fn().mockResolvedValue({id:'contact',name:null,waId:'5511999999999'}),updateMany:jest.fn()},
      conversation:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue(conversation),update:jest.fn(async({data}:any)=>({...conversation,...data}))},
      message:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue({id:'message'})},
      tenant:{findUniqueOrThrow:jest.fn().mockResolvedValue({status:tenantStatus,workspaceSettings:{timezone:'UTC',businessHours:hours,awayMessage:'Closed',stages:[stage]}})},
      user:{findFirst:jest.fn().mockResolvedValue({id:'operator',availability:{available,enabled:false}})},
    };db.$transaction=(f:any)=>f(db);
    const evo:any={sendText:jest.fn().mockResolvedValue({externalId:'sent'})};
    const service=new ConversationsService(db,unused,evo,unused,{dispatch:jest.fn().mockResolvedValue(undefined)} as any);
    return {db,evo,service};
  }
  it('waits for free text, routes once and stops after handoff', async () => {
    const {db,evo,service}=setup(true);
    let state:any={id:'conv',status:'OPEN',funnelStage:null,assignedUserId:null,automationCompleted:false,pendingAutomation:null};
    db.conversation.findFirst.mockImplementation(async()=>state);
    db.conversation.update.mockImplementation(async({data}:any)=>(state={...state,...data}));
    db.tenant.findUniqueOrThrow.mockResolvedValue({status:'ACTIVE',workspaceSettings:{timezone:'UTC',businessHours:{enabled:false},departments:[{id:'finance',name:'Financeiro'}],stages:[{...stage,keyword:'1',message:'Qual sua dúvida?',waitForReply:true,completionMessage:'Aguarde o Financeiro.',departmentId:'finance'}]}});
    await service.recordInboundMessage(channel,'5511999999999','1','first',{});
    expect(state.pendingAutomation).toEqual({message:'Aguarde o Financeiro.',departmentId:'finance'});
    expect(state.departmentId).toBeNull();expect(state.assignedUserId).toBeNull();
    expect(evo.sendText).toHaveBeenLastCalledWith(channel,{to:'5511999999999',text:'Qual sua dúvida?'});
    await service.recordInboundMessage(channel,'5511999999999','','media',{});
    expect(evo.sendText).toHaveBeenCalledTimes(1);
    await service.recordInboundMessage(channel,'5511999999999','Preciso do boleto','second',{});
    expect(state.departmentId).toBe('finance');expect(state.automationCompleted).toBe(true);expect(state.assignedUserId).toBeNull();
    expect(evo.sendText).toHaveBeenLastCalledWith(channel,{to:'5511999999999',text:'Aguarde o Financeiro.'});
    await service.recordInboundMessage(channel,'5511999999999','1','third',{});
    expect(evo.sendText).toHaveBeenCalledTimes(2);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });
  it('does not consume a pending answer while suspended or interrupt a human',async()=>{
    const {db,evo,service}=setup(true, {enabled:false}, 'SUSPENDED');
    let state:any={id:'conv',pendingAutomation:{message:'Done',departmentId:'finance'},assignedUserId:null};
    db.conversation.findFirst.mockImplementation(async()=>state);
    db.conversation.update.mockImplementation(async({data}:any)=>(state={...state,...data}));
    await service.recordInboundMessage(channel,'5511999999999','My question','first',{});
    expect(state.pendingAutomation.message).toBe('Done');expect(evo.sendText).not.toHaveBeenCalled();
    state.assignedUserId='human';await service.recordInboundMessage(channel,'5511999999999','1','second',{});
    expect(state.automationCompleted).toBe(true);expect(evo.sendText).not.toHaveBeenCalled();
  });
  it('captures the profile name and routes only to an available operator',async()=>{
    const {db,evo,service}=setup(true);
    await service.recordInboundMessage(channel,'5511999999999',' SALES ','external',{},'Maria');
    expect(db.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({name:'Maria'})}));
    expect(db.contact.updateMany).toHaveBeenCalledWith({where:{id:'contact',name:null},data:{name:'Maria'}});
    expect(db.conversation.update).toHaveBeenCalledWith({where:{id:'conv'},data:{funnelStage:'stage',assignedUserId:'operator'}});
    expect(evo.sendText).toHaveBeenCalledWith(channel,{to:'5511999999999',text:stage.message});
  });
  it('keeps a routed conversation in the queue when the operator is unavailable',async()=>{
    const {db,service}=setup(false);await service.recordInboundMessage(channel,'5511999999999','sales','external',{});
    expect(db.conversation.update).toHaveBeenCalledWith({where:{id:'conv'},data:{funnelStage:'stage',assignedUserId:null}});
  });
  it('sends away response outside hours instead of welcome or stage messages',async()=>{
    const {db,evo,service}=setup(true,{enabled:true,days:[],start:'08:00',end:'18:00'});
    await service.recordInboundMessage(channel,'5511999999999','sales','external',{});
    expect(db.user.findFirst).not.toHaveBeenCalled();expect(evo.sendText).toHaveBeenCalledWith(channel,{to:'5511999999999',text:'Closed'});
  });
  it('selects contextual steps before global keywords and persists the chosen department',async()=>{
    const {db,service}=setup(true);
    db.conversation.findFirst.mockResolvedValue({id:'conv',funnelStage:'initial'});
    let state:any={id:'conv',funnelStage:'initial'};
    db.conversation.update.mockImplementation(async ({data}:any)=>(state={...state,...data}));
    db.tenant.findUniqueOrThrow.mockResolvedValue({status:'ACTIVE',workspaceSettings:{timezone:'UTC',businessHours:{enabled:false},stages:[{...stage,id:'global',keyword:'1'},{...stage,id:'final',keyword:'1',fromStageId:'initial',departmentId:'finance'}],departments:[{id:'finance',name:'Financeiro'}]}});
    await service.recordInboundMessage(channel,'5511999999999','1','external',{});
    expect(db.conversation.update).toHaveBeenCalledWith({where:{id:'conv'},data:{funnelStage:'final',assignedUserId:'operator'}});
    expect(db.conversation.update).toHaveBeenCalledWith({where:{id:'conv'},data:{departmentId:'finance'}});
  });
  it('records an opt-out, stops all queued campaigns and avoids an automated reply',async()=>{
    const {db,evo,service}=setup(true);await service.recordInboundMessage(channel,'5511999999999','SAIR','external',{});
    expect(db.campaignSuppression.upsert).toHaveBeenCalled();
    expect(db.campaignDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{contactId:'contact',status:'QUEUED',campaign:{tenantId:'tenant'}}}));
    expect(evo.sendText).not.toHaveBeenCalled();
  });
  it('does not auto-send for a suspended company',async()=>{
    const {evo,service}=setup(true,{enabled:false},'SUSPENDED');await service.recordInboundMessage(channel,'5511999999999','sales','external',{});expect(evo.sendText).not.toHaveBeenCalled();
  });
});
