import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const a:AuthenticatedUser={userId:'a',tenantId:'tenant',role:'AGENT',email:'a@example.com'};
const b:AuthenticatedUser={...a,userId:'b'};
const admin:AuthenticatedUser={...a,userId:'admin',role:'ADMIN'};

describe('Conversation assignment and scoped listing',()=>{
  let db:any,service:ConversationsService,state:any,webhooks:any;
  beforeEach(()=>{
    state={id:'c',channelId:'ch',status:'OPEN',assignedUserId:null};
    db={
      $queryRaw:jest.fn().mockResolvedValue([{id:'c'}]),
      conversation:{findFirst:jest.fn(async()=>({...state})),findMany:jest.fn().mockResolvedValue([]),create:jest.fn(),update:jest.fn(async({data}:any)=>{Object.assign(state,data);return {...state,assignedUser:{id:state.assignedUserId,name:'Atendente'}};})},
      user:{findFirst:jest.fn(async({where}:any)=>['a','b','admin'].includes(where.id)?{id:where.id,name:'Atendente'}:null)},
      auditEvent:{create:jest.fn()},
      channel:{findFirst:jest.fn().mockResolvedValue({id:'ch'})},contact:{findFirst:jest.fn().mockResolvedValue({id:'contact',waId:'553198051379'})},
    };
    // Simulate the serialization of transactions waiting for the row lock.
    let tail=Promise.resolve();db.$transaction=(fn:any)=>{const result=tail.then(()=>fn(db));tail=result.then(()=>undefined,()=>undefined);return result;};
    webhooks={dispatch:jest.fn().mockResolvedValue(undefined)};
    service=new ConversationsService(db,{} as any,{} as any,{} as any,webhooks);
  });
  it('allows only one of two concurrent operator claims',async()=>{
    const results=await Promise.allSettled([service.assign('tenant','c','a',a),service.assign('tenant','c','b',b)]);
    expect(results[0].status).toBe('fulfilled');expect(results[1]).toMatchObject({status:'rejected',reason:expect.any(ConflictException)});
    expect(state.assignedUserId).toBe('a');expect(db.conversation.update).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE OF c');
  });
  it('transfers own conversation, keeps history and records actor and target',async()=>{
    state.assignedUserId='a';await service.assign('tenant','c','b',a,true);
    expect(state.assignedUserId).toBe('b');expect(state.pipelineStage).toBe('IN_SERVICE');expect(state.automationCompleted).toBe(true);
    expect(db.auditEvent.create).toHaveBeenCalledWith({data:{tenantId:'tenant',actorId:'a',action:'conversation.transferred:c:b'}});
    expect(webhooks.dispatch).toHaveBeenCalledWith('tenant','conversation.assigned',{conversationId:'c',assignedUserId:'b'});
    await expect(service.assign('tenant','c','a',a,true)).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows admin to reassign another operator',async()=>{state.assignedUserId='b';await service.assign('tenant','c','a',admin,true);expect(state.assignedUserId).toBe('a');});
  it('requires an operator to claim before forwarding',async()=>{await expect(service.assign('tenant','c','b',a,true)).rejects.toBeInstanceOf(ForbiddenException);expect(db.conversation.update).not.toHaveBeenCalled();});
  it('does not accept a target outside the company',async()=>{state.assignedUserId='a';await expect(service.assign('tenant','c','foreign',a,true)).rejects.toBeInstanceOf(ForbiddenException);expect(db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:'foreign',tenantId:'tenant'}}));expect(db.conversation.update).not.toHaveBeenCalled();});
  it('does not transfer a resolved conversation',async()=>{state.status='RESOLVED';await expect(service.assign('tenant','c','b',admin,true)).rejects.toBeInstanceOf(ForbiddenException);});
  it('does not leak or duplicate an assigned conversation through start',async()=>{
    state.assignedUserId='b';await expect(service.start('tenant',{channelId:'ch',phone:'5531998051379'},a)).rejects.toBeInstanceOf(NotFoundException);expect(db.conversation.create).not.toHaveBeenCalled();
  });
  it('scopes operators before pagination and again before hydration',async()=>{
    await service.listForTenant('tenant',{viewer:a,status:'OPEN'});
    const sql=db.$queryRaw.mock.calls[0][0];expect(sql.text).toContain('c.assigned_user_id IS NULL OR c.assigned_user_id =');expect(sql.values).toContain('a');
    expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({channel:{tenantId:'tenant'},OR:[{assignedUserId:null},{assignedUserId:'a'}]}),include:expect.objectContaining({assignedUser:{select:{id:true,name:true}}})}));
  });
  it('keeps admin and company API listings unfiltered by operator',async()=>{
    await service.listForTenant('tenant',{viewer:admin});await service.listForTenant('tenant',{});
    for(const [query] of db.$queryRaw.mock.calls)expect(query.text).not.toContain('assigned_user_id');
    for(const [query] of db.conversation.findMany.mock.calls){expect(query.where.channel).toEqual({tenantId:'tenant'});expect(query.where.OR).toBeUndefined();}
  });
  it('limits visibility reconciliation to the caller company and ownership',async()=>{
    await service.visibleAssignments(a,['c','foreign']);expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:['c','foreign']},channel:{tenantId:'tenant'},OR:[{assignedUserId:null},{assignedUserId:'a'}]}}));
    db.conversation.findMany.mockClear();expect(await service.visibleAssignments(a,[])).toEqual([]);expect(db.conversation.findMany).not.toHaveBeenCalled();
  });
});
