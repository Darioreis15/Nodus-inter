import 'reflect-metadata';
import { assertPlatformOwner } from './owner-access';
import { OwnerController, OwnerService } from './owner.controller';
import { BillingService } from '../billing/billing.service';
import * as bcrypt from 'bcryptjs';
const ownerId = '11111111-1111-4111-8111-111111111111';
describe('Platform owner authorization', () => {
  const previous = process.env.PLATFORM_OWNER_USER_ID;
  afterAll(() => { if (previous === undefined) delete process.env.PLATFORM_OWNER_USER_ID; else process.env.PLATFORM_OWNER_USER_ID = previous; });
  beforeEach(() => { process.env.PLATFORM_OWNER_USER_ID = ownerId; });
  it('fails closed when unconfigured and rejects client admins, agents, password-change accounts', () => {
    for (const user of [undefined, {id:'someone',role:'ADMIN'}, {id:ownerId,role:'AGENT'}, {id:ownerId,role:'ADMIN',mustChangePassword:true}]) expect(()=>assertPlatformOwner(user)).toThrow();
    delete process.env.PLATFORM_OWNER_USER_ID;
    expect(()=>assertPlatformOwner({id:ownerId,role:'ADMIN'})).toThrow();
  });
  it('accepts only the configured administrator', () => { expect(()=>assertPlatformOwner({userId:ownerId,role:'ADMIN'})).not.toThrow(); });
  it('all owner handlers require JWT and owner guards, with suspended access exceptions', () => {
    const guards=Reflect.getMetadata('__guards__',OwnerController);
    expect(guards.map((g:any)=>g.name)).toEqual(['JwtAuthGuard','OwnerGuard']);
    for (const name of (['me','summary','plans','list','plan','cancel','calendarStatus','activate','contractPreview','createContract','createCompany','sandboxBilling'] as const)) expect(Reflect.getMetadata('allowSuspendedTenant',OwnerController.prototype[name])).toBe(true);
  });
  it('cross-tenant cancellation rejects an ordinary company admin before any mutation', async () => {
    const prisma:any={user:{findFirst:jest.fn().mockResolvedValue({id:'not-owner',role:'ADMIN'})},$transaction:jest.fn()};
    const asaas:any={stopRecurrence:jest.fn()};
    await expect(new BillingService(prisma,asaas).cancelAsOwner('target','not-owner',{confirmation:'CANCEL',currentPassword:'secret'})).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(asaas.stopRecurrence).not.toHaveBeenCalled();
  });
  const make = async () => {
    const actor={id:ownerId,role:'ADMIN',tokenVersion:1,passwordHash:await bcrypt.hash('password',4)};
    const tenant={planId:'old',subscription:{status:'ACTIVE'},_count:{users:3,channels:2}};
    const tx:any={$queryRaw:jest.fn(),user:{findUnique:jest.fn().mockResolvedValue(actor)},tenant:{findUnique:jest.fn().mockResolvedValue(tenant),update:jest.fn()},plan:{findUnique:jest.fn().mockResolvedValue({id:'new',maxUsers:5,maxChannels:3})},auditEvent:{create:jest.fn()}};
    const prisma:any={user:tx.user,$transaction:jest.fn(fn=>fn(tx))};
    return {service:new OwnerService(prisma),tx,tenant,dto:{planId:'new',expectedPlanId:'old',currentPassword:'password',confirmation:'ACCESS_ONLY'}};
  };
  it('rejects downgrade exceeding actual usage and leaves plan untouched',async()=>{const {service,tx,dto}=await make();tx.plan.findUnique.mockResolvedValue({id:'new',maxUsers:2,maxChannels:1});await expect(service.changePlan('tenant',ownerId,dto)).rejects.toThrow('Uso atual');expect(tx.tenant.update).not.toHaveBeenCalled();});
  it('rejects stale plan and canceled contracts',async()=>{const {service,tenant,dto}=await make();tenant.planId='changed';await expect(service.changePlan('tenant',ownerId,dto)).rejects.toThrow('outra operacao');tenant.planId='old';tenant.subscription.status='CANCELED';await expect(service.changePlan('tenant',ownerId,dto)).rejects.toThrow('encerrado');});
  it('changes only access limits and records actor, old and new plans',async()=>{const {service,tx,dto}=await make();expect(await service.changePlan('tenant',ownerId,dto)).toMatchObject({billingChanged:false});expect(tx.tenant.update).toHaveBeenCalledWith({where:{id:'tenant'},data:{planId:'new'}});expect(tx.auditEvent.create).toHaveBeenCalledWith({data:{tenantId:'tenant',actorId:ownerId,action:'owner.plan_access_changed:old:new'}});});
  it('wrong password does not start transaction',async()=>{const {service,tx,dto}=await make();await expect(service.changePlan('tenant',ownerId,{...dto,currentPassword:'wrong'})).rejects.toThrow('Senha');expect(tx.$queryRaw).not.toHaveBeenCalled();});
});
