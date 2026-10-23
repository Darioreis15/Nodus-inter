import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export function conversationAccess(user: Pick<AuthenticatedUser,'userId'|'tenantId'|'role'>) {
  return {channel:{tenantId:user.tenantId},...(user.role === 'ADMIN' ? {} : {OR:[{assignedUserId:null},{assignedUserId:user.userId}]})};
}

@Injectable()
export class ConversationAccessGuard implements CanActivate {
  constructor(private prisma:PrismaService) {}
  async canActivate(context:ExecutionContext) {
    const req=context.switchToHttp().getRequest();
    // Collection routes apply their own scoped queries; object routes all pass here.
    if (!req.params.id) return true;
    const user=req.user as AuthenticatedUser;
    const conversation=await this.prisma.conversation.findFirst({where:{id:req.params.id,...conversationAccess(user)},select:{id:true}});
    if (!conversation) throw new NotFoundException('Conversa nao encontrada ou atribuida a outro atendente.');
    return true;
  }
}
