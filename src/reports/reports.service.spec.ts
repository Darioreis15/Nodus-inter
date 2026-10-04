import { ReportsService } from './reports.service';

describe('Reports resolver counts', () => {
  const group = (id: string | null, name: string | null, count: number, time = 1) => ({ resolvedById: id, resolvedByName: name, _count: { _all: count }, _max: { resolvedAt: new Date(time) } });
  function setup(groups: any[]) {
    const db: any = {
      channel: { findMany: jest.fn().mockResolvedValue([{ id: 'own-channel' }]) },
      conversation: { groupBy: jest.fn().mockImplementation(({ by }) => Promise.resolve(by[0] === 'status' ? [{ status:'RESOLVED', _count:{ _all:groups.reduce((n,g)=>n+g._count._all,0) } }] : groups)), findMany: jest.fn().mockResolvedValue([]) },
    };
    return { db, service: new ReportsService(db) };
  }
  it('counts actual resolvers, combines renamed users and preserves deleted user snapshots', async () => {
    const { db, service } = setup([group('a','Ana antiga',2),group('a','Ana',3,2),group('deleted','Operador removido',1)]);
    const r = await service.getSummary('own');
    expect(r.resolvedByUser).toEqual([{ userId:'a',name:'Ana',count:5 },{ userId:'deleted',name:'Operador removido',count:1 }]);
    expect(db.channel.findMany).toHaveBeenCalledWith({ where:{tenantId:'own'},select:{id:true} });
    expect(db.conversation.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by:['resolvedById','resolvedByName'],where:{channelId:{in:['own-channel']},status:'RESOLVED'} }));
    expect(r.resolvedByUser.reduce((n,u)=>n+u.count,0)).toBe(r.conversationsByStatus.RESOLVED);
  });
  it('does not merge different users with identical names and exposes unknown legacy resolvers', async () => {
    const { service } = setup([group('a','Ana',1),group('b','Ana',2),group(null,null,3)]);
    const r = await service.getSummary('own');
    expect(r.resolvedByUser).toContainEqual({userId:null,name:'Usuário não identificado',count:3});
    expect(r.resolvedByUser).toHaveLength(3);
  });
  it('returns an empty section when tenant has no channels without querying other conversations', async () => {
    const { db, service } = setup([]); db.channel.findMany.mockResolvedValue([]);
    expect((await service.getSummary('empty')).resolvedByUser).toEqual([]);
    expect(db.conversation.groupBy).not.toHaveBeenCalled();
  });
});
