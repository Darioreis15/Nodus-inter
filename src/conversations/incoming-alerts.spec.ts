import { incomingAlerts, IncomingAlertsQuery } from './incoming-alerts';
import { validate } from 'class-validator';

describe('incoming alerts', () => {
  const now = new Date('2026-10-25T12:00:00.000Z');
  const user = { tenantId: 'tenant-a', userId: 'agent-a', role: 'AGENT' as const, email: 'test@example.com' };
  const since = '2026-10-25T11:59:00.000Z';
  const findMany = jest.fn();
  const prisma = { message: { findMany } } as any;
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));
  it('initializes without replaying history', async () => {
    expect(await incomingAlerts(prisma,user,{},now)).toEqual({items:[],next:{since:now.toISOString()},initialized:true});
    expect(findMany).not.toHaveBeenCalled();
  });
  it('restricts an agent to their tenant, queue and own conversations, inbound only', async () => {
    await incomingAlerts(prisma,user,{since},now);
    expect(findMany.mock.calls[0][0].where).toMatchObject({direction:'INBOUND',conversation:{channel:{tenantId:'tenant-a'},OR:[{assignedUserId:null},{assignedUserId:'agent-a'}]}});
    expect(findMany.mock.calls[0][0].select).toEqual({id:true,conversationId:true,createdAt:true});
  });
  it('allows admins all assignments but never other tenants', async () => {
    await incomingAlerts(prisma,{...user,role:'ADMIN'},{since},now);
    expect(findMany.mock.calls[0][0].where.conversation).toEqual({channel:{tenantId:'tenant-a'}});
  });
  it('paginates ties without skipping the 101st message and freezes upper bound', async () => {
    const rows = Array.from({length:101},(_,i)=>({id:String(i).padStart(3,'0'),conversationId:'a',createdAt:new Date('2026-10-25T11:59:30Z')}));
    findMany.mockResolvedValueOnce(rows);
    const first = await incomingAlerts(prisma,user,{since},now);
    expect(first.items).toHaveLength(100);expect(first.next).toMatchObject({afterId:'099',until:now.toISOString(),since});
    findMany.mockResolvedValueOnce([rows[100]]);
    const second = await incomingAlerts(prisma,user,first.next,new Date(+now+10000));
    expect(findMany.mock.calls[1][0].where.OR).toEqual([{createdAt:{gt:rows[0].createdAt}},{createdAt:rows[0].createdAt,id:{gt:'099'}}]);
    expect(second.next).toEqual({since:now.toISOString()});
  });
  it('rechecks overlap for a late committed inbound message', async () => {
    await incomingAlerts(prisma,user,{since},now);
    expect(findMany.mock.calls[0][0].where.createdAt.gte).toEqual(new Date(Date.parse(since)-30000));
  });
  it('rejects forged time windows and partial cursors', async () => {
    await expect(incomingAlerts(prisma,user,{since,until:'2099-01-01T00:00:00Z'},now)).rejects.toThrow();
    await expect(incomingAlerts(prisma,user,{since,afterId:'x'},now)).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
    expect((await validate(Object.assign(new IncomingAlertsQuery(),{since:'bad',afterId:'bad'}))).length).toBe(2);
  });
  it('resets after a long offline period', async () => {
    expect((await incomingAlerts(prisma,user,{since:'2026-10-20T00:00:00Z'},now)).initialized).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });
});
