import { contactHistoryScope, listContactHistory, historyAttachmentConversation } from './contact-history';

describe('continuous contact history',()=>{
  const user={tenantId:'tenant-a',userId:'agent-a',role:'AGENT' as const,email:'a@example.com'};
  const createdAt=new Date('2026-10-25T12:00:00Z');
  const current={id:'current',channelId:'channel-a',contactId:'contact-a',createdAt};
  const conversation={findFirst:jest.fn()};
  const message={findFirst:jest.fn(),findMany:jest.fn()};
  const prisma={conversation,message} as any;
  beforeEach(()=>{jest.clearAllMocks();conversation.findFirst.mockResolvedValue(current);message.findFirst.mockResolvedValue(null);message.findMany.mockResolvedValue([]);});
  it('requires current case access and isolates channel, contact and tenant',async()=>{
    const scope=await contactHistoryScope(prisma,user,'current');
    expect(conversation.findFirst.mock.calls[0][0].where).toEqual({id:'current',channel:{tenantId:'tenant-a'},OR:[{assignedUserId:null},{assignedUserId:'agent-a'}]});
    expect(scope).toEqual({conversation:{channelId:'channel-a',contactId:'contact-a',channel:{tenantId:'tenant-a'},OR:[{id:'current'},{status:'RESOLVED',createdAt:{lte:createdAt}}]}});
  });
  it('denies stale access after a transfer, including attachments',async()=>{
    conversation.findFirst.mockResolvedValue(null);
    await expect(listContactHistory(prisma,user,'current')).rejects.toThrow('Conversa nao encontrada');
    await expect(historyAttachmentConversation(prisma,user,'current','m')).rejects.toThrow();
    expect(message.findMany).not.toHaveBeenCalled();expect(message.findFirst).not.toHaveBeenCalled();
  });
  it('combines prior resolved and current messages without modifying cases',async()=>{
    message.findMany.mockResolvedValue([{id:'new',conversationId:'current',media:null},{id:'old',conversationId:'previous',media:null}]);
    const result=await listContactHistory(prisma,user,'current');
    expect(result.map(m=>[m.id,m.previousAttendance])).toEqual([['new',false],['old',true]]);
    expect(message.findMany.mock.calls[0][0]).toMatchObject({orderBy:[{createdAt:'desc'},{id:'desc'}],take:100});
  });
  it('rejects cursors outside the permitted timeline',async()=>{
    await expect(listContactHistory(prisma,user,'current','foreign-message')).rejects.toThrow('Mensagem nao encontrada');
    expect(message.findMany).not.toHaveBeenCalled();
    expect(message.findFirst.mock.calls[0][0].where.AND[0].conversation.channel).toEqual({tenantId:'tenant-a'});
  });
  it('paginates across earlier cases with timestamp and ID tie breaking',async()=>{
    const time=new Date('2026-10-24T09:00:00Z');message.findFirst.mockResolvedValue({id:'cursor',createdAt:time});
    await listContactHistory(prisma,user,'current','cursor');
    expect(message.findMany.mock.calls[0][0].where.AND[1]).toEqual({OR:[{createdAt:{lt:time}},{createdAt:time,id:{lt:'cursor'}}]});
  });
  it('routes a permitted old attachment to its original conversation',async()=>{
    message.findFirst.mockResolvedValue({conversationId:'previous'});
    expect(await historyAttachmentConversation(prisma,user,'current','pdf')).toBe('previous');
    expect(message.findFirst.mock.calls[0][0].where.AND[1]).toEqual({id:'pdf'});
  });
  it('rejects attachments outside the history even with current case access',async()=>{
    await expect(historyAttachmentConversation(prisma,user,'current','foreign')).rejects.toThrow('Anexo nao encontrado');
  });
  it('does not expose raw provider metadata',async()=>{
    await listContactHistory(prisma,user,'current');
    const selection=message.findMany.mock.calls[0][0].select;
    expect(selection.raw).toBeUndefined();expect(selection.externalId).toBeUndefined();
  });
});
