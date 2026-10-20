import { BillingCalendar, firstCalendarMonth, nextMonth, saoPauloDate, billingReference } from './billing-calendar';
import { BillingRunController } from './billing-run.controller';
import { BillingService } from './billing.service';

describe('Monthly billing calendar', () => {
  let prisma:any, asaas:any, service:BillingCalendar, sub:any, cycle:any;
  const id='11111111-1111-4111-8111-111111111111';
  const previous=process.env.BILLING_CALENDAR_ENABLED;
  afterAll(()=>{if(previous===undefined)delete process.env.BILLING_CALENDAR_ENABLED;else process.env.BILLING_CALENDAR_ENABLED=previous;});
  beforeEach(()=>{
    process.env.BILLING_CALENDAR_ENABLED='true';
    sub={id,tenantId:'tenant',status:'ACTIVE',tenant:{status:'ACTIVE'},asaasCustomerId:'cus',asaasSubscriptionId:'sub',calendarEnabled:true,billingStartMonth:'2026-11',billingPriceCents:9900,billingOptions:{billingType:'UNDEFINED'},billingCycles:[]};
    cycle={id:'cycle',subscriptionId:id,month:'2026-11',dueDate:'2026-11-10',valueCents:9900,state:'READY',subscription:sub};
    prisma={subscription:{findUniqueOrThrow:jest.fn().mockImplementation(()=>Promise.resolve(sub)),update:jest.fn(),updateMany:jest.fn()},billingCycle:{findUnique:jest.fn().mockResolvedValue(null),findUniqueOrThrow:jest.fn().mockImplementation(()=>Promise.resolve(cycle)),upsert:jest.fn().mockImplementation(()=>Promise.resolve(cycle)),update:jest.fn(),updateMany:jest.fn().mockResolvedValue({count:1})},tenant:{update:jest.fn()},auditEvent:{create:jest.fn()},$queryRaw:jest.fn()};
    prisma.$transaction=jest.fn((fn:any)=>fn(prisma));
    asaas={getSubscription:jest.fn().mockResolvedValue({id:'sub',customer:'cus',cycle:'MONTHLY',billingType:'UNDEFINED',value:89,status:'INACTIVE'}),stopRecurrence:jest.fn(),allPayments:jest.fn().mockResolvedValue([]),getPayment:jest.fn(),createCalendarPayment:jest.fn().mockResolvedValue({id:'pay',customer:'cus',externalReference:billingReference(id,'2026-11'),value:99,dueDate:'2026-11-10',status:'PENDING'})};
    service=new BillingCalendar(prisma,asaas);
  });
  it('uses Sao Paulo at the UTC month boundary and handles December',()=>{
    expect(saoPauloDate(new Date('2026-11-01T02:59:59Z'))).toBe('2026-10-31');
    expect(saoPauloDate(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11-01');
    expect(firstCalendarMonth('2026-11-01')).toBe('2026-11');expect(firstCalendarMonth('2026-11-02')).toBe('2026-12');expect(nextMonth('2026-12')).toBe('2027-01');
  });
  it('does not issue before first month or after cancellation',async()=>{await service.issue(id,'2026-10-31');sub.status='CANCELED';await service.issue(id,'2026-11-01');expect(asaas.createCalendarPayment).not.toHaveBeenCalled();});
  it('issues one charge due on day 10 with a stable reference and contracted value',async()=>{await service.issue(id,'2026-11-01');expect(asaas.createCalendarPayment).toHaveBeenCalledWith(expect.objectContaining({dueDate:'2026-11-10',value:99,externalReference:billingReference(id,'2026-11')}));expect(prisma.billingCycle.update).toHaveBeenCalledWith({where:{id:'cycle'},data:{state:'CREATED',paymentId:'pay',error:null}});});
  it('blocks emission if native recurrence was reactivated',async()=>{asaas.getSubscription.mockResolvedValue({status:'ACTIVE'});await expect(service.issue(id,'2026-11-01')).rejects.toThrow();expect(asaas.createCalendarPayment).not.toHaveBeenCalled();});
  it('losing a concurrent claim never posts',async()=>{prisma.billingCycle.updateMany.mockResolvedValue({count:0});await service.issue(id,'2026-11-01');expect(asaas.createCalendarPayment).not.toHaveBeenCalled();});
  it('timeout leaves durable uncertain intent and retry only looks up, never reposts',async()=>{
    asaas.createCalendarPayment.mockRejectedValue(new Error('timeout'));await expect(service.issue(id,'2026-11-01')).rejects.toThrow('pendente');
    cycle.state='SENDING';await expect(service.issue(id,'2026-11-01')).rejects.toThrow('conciliacao');expect(asaas.createCalendarPayment).toHaveBeenCalledTimes(1);
  });
  it('recovers an existing payment without creating another',async()=>{cycle.state='SENDING';asaas.allPayments.mockResolvedValueOnce([await asaas.createCalendarPayment()]);asaas.createCalendarPayment.mockClear();await service.issue(id,'2026-11-01');expect(asaas.createCalendarPayment).not.toHaveBeenCalled();expect(prisma.billingCycle.update).toHaveBeenCalledWith(expect.objectContaining({data:{state:'CREATED',paymentId:'pay',error:null}}));});
  it('never silently creates an overdue invoice after outage',async()=>{await service.issue(id,'2026-11-11');expect(asaas.createCalendarPayment).not.toHaveBeenCalled();expect(prisma.subscription.update).toHaveBeenCalledWith({where:{id},data:{calendarError:'MISSED_CYCLE:2026-11'}});});
  it('rechecks cancellation under the emission lock',async()=>{let calls=0;prisma.subscription.findUniqueOrThrow.mockImplementation(()=>Promise.resolve(++calls===1?{...sub}:{...sub,status:'CANCELED'}));await service.issue(id,'2026-11-01');expect(asaas.createCalendarPayment).not.toHaveBeenCalled();});
  it('migration preserves existing invoices and contracted price, starts after last invoice month',async()=>{
    sub.calendarEnabled=false;asaas.allPayments.mockResolvedValue([{id:'existing',dueDate:'2026-12-25',status:'PENDING'}]);await service.migrate(id,'2026-10-14');
    expect(asaas.stopRecurrence).toHaveBeenCalledWith('sub');expect(asaas.createCalendarPayment).not.toHaveBeenCalled();expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({billingPriceCents:8900,billingStartMonth:'2027-01',calendarEnabled:true})}));
  });
  it('failed stop never enables the new stream',async()=>{sub.calendarEnabled=false;asaas.stopRecurrence.mockRejectedValue(new Error('offline'));await expect(service.migrate(id,'2026-10-14')).rejects.toThrow();expect(prisma.subscription.update).not.toHaveBeenCalled();});
  it('card or finite subscriptions require review without altering recurrence',async()=>{sub.calendarEnabled=false;asaas.getSubscription.mockResolvedValue({id:'sub',customer:'cus',cycle:'MONTHLY',billingType:'CREDIT_CARD',value:89,status:'ACTIVE'});await expect(service.migrate(id,'2026-10-14')).rejects.toThrow();expect(asaas.stopRecurrence).not.toHaveBeenCalled();});
  it('ignores payment from another customer',async()=>{asaas.getPayment.mockResolvedValue({id:'pay',customer:'attacker',externalReference:billingReference(id,'2026-11')});prisma.billingCycle.findUnique.mockResolvedValue(cycle);await service.reconcilePayment('pay');expect(prisma.billingCycle.update).not.toHaveBeenCalled();});
  it('calendar reconciliation includes old overdue invoices and new payments',async()=>{sub.billingCycles=[{paymentId:'new'}];asaas.allPayments.mockResolvedValue([{id:'old',subscription:'sub',status:'OVERDUE'},{id:'new',status:'RECEIVED'}]);await service.reconcileStatus(id);expect(prisma.tenant.update).toHaveBeenCalledWith({where:{id:'tenant'},data:{status:'SUSPENDED'}});});
  it('canceled contract is not reactivated by a late payment',async()=>{sub.status='CANCELED';await service.reconcileStatus(id);expect(prisma.tenant.update).not.toHaveBeenCalled();});
  it('scheduler requires an independently configured secret',async()=>{
    const old=process.env.BILLING_RUN_TOKEN;try{delete process.env.BILLING_RUN_TOKEN;const controller=new BillingRunController(service,{run:jest.fn()} as any);await expect(controller.run()).rejects.toThrow();process.env.BILLING_RUN_TOKEN='x'.repeat(32);await expect(controller.run('wrong')).rejects.toThrow();}finally{if(old===undefined)delete process.env.BILLING_RUN_TOKEN;else process.env.BILLING_RUN_TOKEN=old;}
  });
  it('new contracts schedule next month without creating a native recurring subscription',async()=>{
    prisma.subscription.findUnique=jest.fn().mockResolvedValue(null);prisma.subscription.create=jest.fn().mockResolvedValue(sub);prisma.tenant.findUniqueOrThrow=jest.fn().mockResolvedValue({name:'Demo',plan:{priceCents:9900}});asaas.createCustomer=jest.fn().mockResolvedValue({id:'cus'});asaas.createSubscription=jest.fn();
    const result=await new BillingService(prisma,asaas,service).subscribe('tenant',{cpfCnpj:'12345678909'});
    expect(result).toMatchObject({scheduled:true,invoiceUrl:null});expect(asaas.createSubscription).not.toHaveBeenCalled();expect(asaas.createCalendarPayment).not.toHaveBeenCalled();
  });
});
