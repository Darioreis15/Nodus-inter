import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { conversationAccess } from './conversation-access.guard';
import { publicMedia } from './message-media';

// Access to the current case grants read-only context from earlier closed cases
// for this exact contact/channel. Other active cases and later cases are excluded.
export async function contactHistoryScope(prisma: PrismaService, user: AuthenticatedUser, id: string): Promise<Prisma.MessageWhereInput> {
  const current = await prisma.conversation.findFirst({
    where: { id, ...conversationAccess(user) },
    select: { id: true, channelId: true, contactId: true, createdAt: true },
  });
  if (!current) throw new NotFoundException('Conversa nao encontrada.');
  return { conversation: {
    channelId: current.channelId, contactId: current.contactId, channel: { tenantId: user.tenantId },
    OR: [{ id: current.id }, { status: 'RESOLVED', createdAt: { lte: current.createdAt } }],
  } };
}
export async function listContactHistory(prisma: PrismaService, user: AuthenticatedUser, id: string, cursor?: string) {
  const scope = await contactHistoryScope(prisma, user, id);
  const anchor = cursor ? await prisma.message.findFirst({where: { AND: [scope, { id: cursor }] },select:{id:true,createdAt:true}}) : null;
  if (cursor && !anchor) throw new NotFoundException('Mensagem nao encontrada neste historico.');
  const rows = await prisma.message.findMany({
    where: { AND: [scope, ...(anchor ? [{ OR: [{createdAt:{lt:anchor.createdAt}}, {createdAt:anchor.createdAt,id:{lt:anchor.id}}] }] : [])] },
    orderBy: [{createdAt:'desc'},{id:'desc'}], take:100,
    select: {id:true,conversationId:true,direction:true,body:true,status:true,createdAt:true,fromNumber:true,toNumber:true,media:true},
  });
  return rows.map(row=>({...row,previousAttendance:row.conversationId!==id,media:publicMedia(row.media)}));
}
export async function historyAttachmentConversation(prisma:PrismaService,user:AuthenticatedUser,id:string,messageId:string) {
  const scope = await contactHistoryScope(prisma,user,id);
  const message = await prisma.message.findFirst({where:{AND:[scope,{id:messageId}]},select:{conversationId:true}});
  if (!message) throw new NotFoundException('Anexo nao encontrado neste historico.');
  return message.conversationId;
}
