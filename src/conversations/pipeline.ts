import { Prisma } from '@prisma/client';
export const PIPELINE_STAGES = ['QUEUE','IN_SERVICE','WAITING','RESOLVED'] as const;
export function pipelineSettings(settings:unknown) {
  const p=(settings as any)?.pipeline;
  return {enabled:p?.enabled !== false,waitMinutes:Number.isInteger(p?.waitMinutes) && p.waitMinutes>=1 && p.waitMinutes<=1440 ? p.waitMinutes : 10};
}
export function inboundPipeline(assignedUserId:string|null) {return {pipelineStage:assignedUserId ? 'IN_SERVICE' : 'QUEUE',replyDueAt:null};}
export function outboundPipeline(settings:unknown,now:Date) {
  const p=pipelineSettings(settings);
  return {status:'PENDING' as const,pipelineStage:'IN_SERVICE',replyDueAt:p.enabled ? new Date(now.getTime()+p.waitMinutes*60000) : null};
}
// Run after a successful outbound send. Same tenant lock
// as inbound processing prevents a delayed provider response undoing a client reply.
export async function trackOutbound(tx:Prisma.TransactionClient, tenantId:string, conversationId:string, startedAt:Date) {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
  const tenant=await tx.tenant.findUniqueOrThrow({where:{id:tenantId}});
  const inbound=await tx.message.findFirst({where:{conversationId,direction:'INBOUND',createdAt:{gte:startedAt}},select:{id:true}});
  if (inbound) return;
  await tx.conversation.updateMany({where:{id:conversationId,channel:{tenantId},status:{not:'RESOLVED'}},data:outboundPipeline(tenant.workspaceSettings,new Date())});
}
