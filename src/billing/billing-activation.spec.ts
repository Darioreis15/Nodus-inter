import { BillingActivation } from './billing-activation';
import * as bcrypt from 'bcryptjs';

describe('Owner contract activation',()=>{
 const owner='11111111-1111-4111-8111-111111111111';
 let prisma:any,asaas:any,service:BillingActivation,sub:any,actor:any;
 const priorOwner=process.env.PLATFORM_OWNER_USER_ID,priorEnabled=process.env.BILLING_CALENDAR_ENABLED;
 const dto={currentPassword:'password',confirmation:'ACTIVATE'};
 beforeEach(async()=>{
  process.env.PLATFORM_OWNER_USER_ID=owner;process.env.BILLING_CALENDAR_ENABLED='true';
  actor={id:owner,role:'ADMIN',passwordHash:await bcrypt.hash('password',4),tokenVersion:1};
  sub={id:'contract',status:'CANCELED',cancellationPending:false,asaasCustomerId:'cus',asaasSubscriptionId:'remote',calendarEnabled:true,billingPriceCents:9900,billingOptions:{billingType:'UNDEFINED'},billingCycles:[]};
  prisma={user:{findUnique:jest.fn().mockImplementation(()=>actor)},tenant:{findUnique:jest.fn().mockResolvedValue({status:'SUSPENDED'}),update:jest.fn()},subscription:{findUnique:jest.fn().mockImplementation(()=>sub),update:jest.fn()},auditEvent:{create:jest.fn()},$queryRaw:jest.fn()};prisma.$transaction=jest.fn((fn:any)=>fn(prisma));
  asaas={allPayments:jest.fn().mockResolvedValue([]),stopRecurrence:jest.fn(),getSubscription:jest.fn().mockResolvedValue({id:'remote',customer:'cus',cycle:'MONTHLY',billingType:'UNDEFINED',value:89,status:'INACTIVE'})};
  service=new BillingActivation(prisma,asaas);
 });
 afterAll(()=>{if(priorOwner===undefined)delete process.env.PLATFORM_OWNER_USER_ID;else process.env.PLATFORM_OWNER_USER_ID=priorOwner;if(priorEnabled===undefined)delete process.env.BILLING_CALENDAR_ENABLED;else process.env.BILLING_CALENDAR_ENABLED=priorEnabled;});
 it('rejects other company admins before mutation',async()=>{actor.id='other';await expect(service.activate('tenant','other',dto)).rejects.toThrow();expect(prisma.$transaction).not.toHaveBeenCalled();});
 it('requires confirmation and the correct password',async()=>{await expect(service.activate('tenant',owner,{...dto,confirmation:'wrong'})).rejects.toThrow();await expect(service.activate('tenant',owner,{...dto,currentPassword:'wrong'})).rejects.toThrow();expect(prisma.subscription.update).not.toHaveBeenCalled();});
 it('rejects pending cancellation and uncertain emissions',async()=>{sub.cancellationPending=true;await expect(service.activate('tenant',owner,dto)).rejects.toThrow('cancelamento pendente');sub.cancellationPending=false;sub.billingCycles=[{state:'SENDING'}];await expect(service.activate('tenant',owner,dto)).rejects.toThrow('emissao pendente');expect(asaas.stopRecurrence).not.toHaveBeenCalled();});
 it('requires a contract and an enabled scheduler',async()=>{process.env.BILLING_CALENDAR_ENABLED='false';await expect(service.activate('tenant',owner,dto)).rejects.toThrow('calendario');sub=null;await expect(service.activate('tenant',owner,dto)).rejects.toThrow('sem contrato');});
 it('does not forgive overdue invoices or change recurrence on rejection',async()=>{asaas.allPayments.mockResolvedValue([{id:'p',subscription:'remote',status:'OVERDUE',dueDate:'2026-01-10'}]);await expect(service.activate('tenant',owner,dto)).rejects.toThrow('vencidas');expect(asaas.stopRecurrence).not.toHaveBeenCalled();expect(prisma.tenant.update).not.toHaveBeenCalled();});
 it('ignores unrelated customer payments for debt checks',async()=>{asaas.allPayments.mockResolvedValue([{id:'unrelated',subscription:'other',status:'OVERDUE',dueDate:'2026-01-10'}]);expect(await service.activate('tenant',owner,dto)).toMatchObject({tenantStatus:'ACTIVE'});});
 it('preserves future invoices and does not restart cancelled cycles or campaigns',async()=>{asaas.allPayments.mockResolvedValue([{id:'p',subscription:'remote',status:'PENDING',dueDate:'2099-11-20'}]);sub.billingCycles=[{month:'2099-12',state:'CANCELLED'}];const result=await service.activate('tenant',owner,dto);expect(result).toMatchObject({firstIssueDate:'2100-01-01',firstDueDate:'2100-01-10',campaignsResumed:false});expect(prisma.auditEvent.create).toHaveBeenCalledWith({data:{tenantId:'tenant',actorId:owner,action:'billing.owner_activated:CANCELED:2100-01'}});});
 it('preserves remote price for old contracts',async()=>{sub.calendarEnabled=false;await service.activate('tenant',owner,dto);expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({billingPriceCents:8900,status:'ACTIVE',canceledAt:null})}));});
 it('remote failure never enables the tenant',async()=>{asaas.stopRecurrence.mockRejectedValue(new Error('offline'));await expect(service.activate('tenant',owner,dto)).rejects.toThrow();expect(prisma.tenant.update).not.toHaveBeenCalled();});
 it('repeated activation of an active contract is a no-op',async()=>{sub.status='ACTIVE';prisma.tenant.findUnique.mockResolvedValue({status:'ACTIVE'});expect(await service.activate('tenant',owner,dto)).toMatchObject({alreadyActive:true});expect(asaas.stopRecurrence).not.toHaveBeenCalled();expect(prisma.subscription.update).not.toHaveBeenCalled();});
});
