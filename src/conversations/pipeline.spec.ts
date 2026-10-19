import { inboundPipeline,outboundPipeline,trackOutbound } from './pipeline';
import { PipelineWorker,PipelineRunController } from './pipeline-worker';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PipelineSettingsDto,FunnelStageDto } from '../workspace/workspace.dto';
describe('Automatic pipeline',()=>{
 const now=new Date('2026-10-19T10:00:00Z');
 it('waits ten minutes by default and honors a configured interval',()=>{
  expect(outboundPipeline({},now)).toEqual({status:'PENDING',pipelineStage:'IN_SERVICE',replyDueAt:new Date('2026-10-19T10:10:00Z')});
  expect(outboundPipeline({pipeline:{waitMinutes:2}},now).replyDueAt).toEqual(new Date('2026-10-19T10:02:00Z'));
  expect(outboundPipeline({pipeline:{enabled:false}},now).replyDueAt).toBeNull();
 });
 it('clears deadlines and restores the correct queue when a client replies',()=>{
  expect(inboundPipeline('user')).toEqual({pipelineStage:'IN_SERVICE',replyDueAt:null});
  expect(inboundPipeline(null)).toEqual({pipelineStage:'QUEUE',replyDueAt:null});
 });
 it('does not undo a reply received while the provider was sending',async()=>{
  const db:any={$queryRaw:jest.fn(),tenant:{findUniqueOrThrow:jest.fn().mockResolvedValue({workspaceSettings:{}})},message:{findFirst:jest.fn().mockResolvedValue({id:'reply'})},conversation:{updateMany:jest.fn()}};
  await trackOutbound(db,'t','c',now);expect(db.conversation.updateMany).not.toHaveBeenCalled();
  expect(db.message.findFirst).toHaveBeenCalledWith({where:{conversationId:'c',direction:'INBOUND',createdAt:{gte:now}},select:{id:true}});
 });
 function setup(){
  const state:any={id:'c',replyDueAt:now,status:'PENDING',pipelineStage:'IN_SERVICE',channel:{tenantId:'t'}};
  const db:any={$queryRaw:jest.fn(),tenant:{findUniqueOrThrow:jest.fn().mockResolvedValue({status:'ACTIVE',workspaceSettings:{}})},conversation:{findMany:jest.fn(async()=>[{...state}]),updateMany:jest.fn(async({where,data})=>{if(state.replyDueAt!==where.replyDueAt || state.status==='RESOLVED')return {count:0};Object.assign(state,data);return {count:1};})}};
  db.$transaction=(fn:any)=>fn(db);return {db,state,worker:new PipelineWorker(db)};
 }
 it('moves only due open conversations, with tenant-scoped conditional writes',async()=>{
  const {db,state,worker}=setup();expect(await worker.tick(now)).toEqual({processed:1,moved:1});expect(state.pipelineStage).toBe('WAITING');expect(state.replyDueAt).toBeNull();
  expect(db.conversation.findMany.mock.calls[0][0].where).toEqual({replyDueAt:{lte:now},status:{not:'RESOLVED'},channel:{tenant:{status:'ACTIVE'}}});
  expect(db.conversation.updateMany.mock.calls[0][0].where.channel).toEqual({tenantId:'t'});
 });
 it.each(['reply','resolve','new-send'])('does not overwrite a concurrent %s',async event=>{
  const {db,state,worker}=setup();db.$transaction=async(fn:any)=>{if(event==='reply')state.replyDueAt=null;else if(event==='resolve')state.status='RESOLVED';else state.replyDueAt=new Date(now.getTime()+600000);return fn(db);};
  expect((await worker.tick(now)).moved).toBe(0);expect(state.pipelineStage).toBe('IN_SERVICE');
 });
 it('disabling timeout clears it without changing the column',async()=>{const {db,state,worker}=setup();db.tenant.findUniqueOrThrow.mockResolvedValue({status:'ACTIVE',workspaceSettings:{pipeline:{enabled:false}}});await worker.tick(now);expect(state.replyDueAt).toBeNull();expect(state.pipelineStage).toBe('IN_SERVICE');});
 it('prevents overlapping ticks',async()=>{const {db,worker}=setup();let done:any;db.conversation.findMany.mockImplementation(()=>new Promise(r=>done=r));const first=worker.tick(now);expect(await worker.tick(now)).toEqual({busy:true});done([]);await first;});
 it('requires a separate long runner token',()=>{const old=process.env.FUNNEL_RUN_TOKEN;try{process.env.FUNNEL_RUN_TOKEN='x'.repeat(32);const tick=jest.fn();const controller=new PipelineRunController({tick} as any);expect(()=>controller.run()).toThrow();expect(()=>controller.run('wrong')).toThrow();controller.run('x'.repeat(32));expect(tick).toHaveBeenCalledTimes(1);}finally{if(old===undefined)delete process.env.FUNNEL_RUN_TOKEN;else process.env.FUNNEL_RUN_TOKEN=old;}});
 it.each([0,1441,1.5])('rejects invalid timer %s',async minutes=>{expect((await validate(plainToInstance(PipelineSettingsDto,{enabled:true,waitMinutes:minutes}))).length).toBeGreaterThan(0);});
 it('rejects a rule trying to finalize silently',async()=>{const errors=await validate(plainToInstance(FunnelStageDto,{pipelineStage:'RESOLVED'}));expect(errors.some(e=>e.property==='pipelineStage')).toBe(true);});
});
