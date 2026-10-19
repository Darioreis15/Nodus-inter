import { Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
export class NoteDto {
  @Transform(({value}) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
}
class NotesQuery { @IsOptional() @IsUUID() cursor?: string; }
const select = {id:true, body:true, createdAt:true, author:{select:{id:true,name:true}}} as const;
@Injectable()
export class ConversationNotesService {
  constructor(private prisma:PrismaService) {}
  async list(tenantId:string, conversationId:string, cursor?:string) {
    const conversation = await this.prisma.conversation.findFirst({where:{id:conversationId,channel:{tenantId}},select:{id:true}});
    if (!conversation) throw new NotFoundException('Conversa nao encontrada.');
    if (cursor && !await this.prisma.conversationNote.findFirst({where:{id:cursor,conversationId,conversation:{channel:{tenantId}}},select:{id:true}})) throw new NotFoundException('Observacao nao encontrada.');
    const rows=await this.prisma.conversationNote.findMany({where:{conversationId,conversation:{channel:{tenantId}}},select,orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(cursor ? {cursor:{id:cursor},skip:1} : {})});
    return {items:rows.slice(0,50),nextCursor:rows.length>50 ? rows[49].id : null};
  }
  async create(tenantId:string, conversationId:string, authorId:string, body:string) {
    return this.prisma.$transaction(async tx => {
      const conversation=await tx.conversation.findFirst({where:{id:conversationId,channel:{tenantId}},select:{id:true}});
      const author=await tx.user.findFirst({where:{id:authorId,tenantId},select:{id:true}});
      if (!conversation || !author) throw new NotFoundException('Conversa ou usuario nao encontrado.');
      return tx.conversationNote.create({data:{conversationId,authorId,body},select});
    });
  }
}
@Controller('conversations/:id/notes')
@UseGuards(JwtAuthGuard)
export class ConversationNotesController {
  constructor(private notes:ConversationNotesService) {}
  @Get() list(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string,@Query() query:NotesQuery) {return this.notes.list(user.tenantId,id,query.cursor);}
  @Post() create(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string,@Body() dto:NoteDto) {return this.notes.create(user.tenantId,id,user.userId,dto.body);}
}
