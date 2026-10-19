import { ConversationNotesService, NoteDto } from './conversation-notes';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
describe('Internal conversation notes',()=>{
 let db:any,service:ConversationNotesService;
 beforeEach(()=>{db={conversation:{findFirst:jest.fn().mockResolvedValue({id:'c'})},user:{findFirst:jest.fn().mockResolvedValue({id:'u'})},conversationNote:{findFirst:jest.fn(),findMany:jest.fn().mockResolvedValue([]),create:jest.fn().mockResolvedValue({id:'n',body:'Interno'})}};db.$transaction=(fn:any)=>fn(db);service=new ConversationNotesService(db);});
 it('checks tenant on read and write and stores notes separately from messages',async()=>{
  await service.list('t','c');await service.create('t','c','u','Interno');
  expect(db.conversation.findFirst).toHaveBeenCalledWith({where:{id:'c',channel:{tenantId:'t'}},select:{id:true}});
  expect(db.user.findFirst).toHaveBeenCalledWith({where:{id:'u',tenantId:'t'},select:{id:true}});
  expect(db.conversationNote.create).toHaveBeenCalledWith(expect.objectContaining({data:{conversationId:'c',authorId:'u',body:'Interno'}}));
 });
 it('denies cross-tenant read/write before notes are accessed',async()=>{
  db.conversation.findFirst.mockResolvedValue(null);
  await expect(service.list('other','c')).rejects.toThrow('Conversa');await expect(service.create('other','c','u','x')).rejects.toThrow('Conversa');
  expect(db.conversationNote.findMany).not.toHaveBeenCalled();expect(db.conversationNote.create).not.toHaveBeenCalled();
 });
 it('rejects cursors outside the authorized conversation',async()=>{db.conversationNote.findFirst.mockResolvedValue(null);await expect(service.list('t','c','foreign')).rejects.toThrow('Observacao');expect(db.conversationNote.findMany).not.toHaveBeenCalled();});
 it('paginates without losing the extra row',async()=>{db.conversationNote.findMany.mockResolvedValue(Array.from({length:51},(_,i)=>({id:String(i)})));const result=await service.list('t','c');expect(result.items).toHaveLength(50);expect(result.nextCursor).toBe('49');});
 it.each(['   ','x'.repeat(4001),42])('rejects invalid notes',async body=>{expect((await validate(plainToInstance(NoteDto,{body}))).length).toBeGreaterThan(0);});
 it('trims valid notes',async()=>{const dto=plainToInstance(NoteDto,{body:'  Interno  '});expect(await validate(dto)).toHaveLength(0);expect(dto.body).toBe('Interno');});
});
