import { CanActivate, ExecutionContext, Injectable, NotFoundException, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export function conversationAccess(user: Pick<AuthenticatedUser,'userId'|'tenantId'|'role'>) {
  return {channel:{tenantId:user.tenantId},...(user.role === 'ADMIN' ? {} : {OR:[{assignedUserId:null},{assignedUserId:user.userId}]})};
}

const REQUIRES_ASSIGNEE = 'conversation:requires-assignee';
export const RequireConversationAssignee = () => SetMetadata(REQUIRES_ASSIGNEE, true);

@Injectable()
export class ConversationAccessGuard implements CanActivate {
  constructor(private prisma:PrismaService, private reflector:Reflector) {}
  async canActivate(context:ExecutionContext) {
    const req=context.switchToHttp().getRequest();
    // Collection routes apply their own scoped queries; object routes all pass here.
    if (!req.params.id) return true;
    const user=req.user as AuthenticatedUser;
    const conversation=await this.prisma.conversation.findFirst({where:{id:req.params.id,...conversationAccess(user)},select:{id:true,assignedUserId:true,status:true}});
    if (!conversation) throw new NotFoundException('Conversa nao encontrada ou atribuida a outro atendente.');
    if (this.reflector.get<boolean>(REQUIRES_ASSIGNEE, context.getHandler())) {
      if (conversation.status === 'RESOLVED') throw new ForbiddenException('Atendimento finalizado. Inicie uma nova conversa.');
      if (conversation.assignedUserId !== user.userId) throw new ForbiddenException('Assuma o atendimento antes de enviar mensagens.');
    }
    return true;
  }
}
