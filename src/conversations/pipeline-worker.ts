import { Controller, Headers, Injectable, Logger, OnModuleDestroy, OnModuleInit, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { pipelineSettings } from './pipeline';
@Injectable()
export class PipelineWorker implements OnModuleInit, OnModuleDestroy {
  private timer?:NodeJS.Timeout;
  private running=false;
  private logger=new Logger(PipelineWorker.name);
  constructor(private prisma:PrismaService) {}
  onModuleInit(){this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.warn('Falha ao processar prazos do funil. Nova tentativa no proximo ciclo.')),30000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async tick(now=new Date()) {
    if(this.running)return {busy:true};this.running=true;
    try{
      const rows=await this.prisma.conversation.findMany({where:{replyDueAt:{lte:now},status:{not:'RESOLVED'},channel:{tenant:{status:'ACTIVE'}}},orderBy:[{replyDueAt:'asc'},{id:'asc'}],take:200,select:{id:true,replyDueAt:true,channel:{select:{tenantId:true}}}});
      let moved=0;
      for(const row of rows){
        moved+=await this.prisma.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${row.channel.tenantId} FOR UPDATE`;
          const tenant=await tx.tenant.findUniqueOrThrow({where:{id:row.channel.tenantId}});
          if(tenant.status!=='ACTIVE')return 0;
          const enabled=pipelineSettings(tenant.workspaceSettings).enabled;
          const result=await tx.conversation.updateMany({where:{id:row.id,replyDueAt:row.replyDueAt,status:{not:'RESOLVED'},channel:{tenantId:row.channel.tenantId}},data:{...(enabled?{pipelineStage:'WAITING'}:{}),replyDueAt:null}});
          return enabled?result.count:0;
        });
      }
      return {processed:rows.length,moved};
    }finally{this.running=false;}
  }
}
@Controller('internal/funnel')
export class PipelineRunController {
  constructor(private worker:PipelineWorker) {}
  @Post('run') run(@Headers('x-funnel-run-token') token?:string){
    const expected=process.env.FUNNEL_RUN_TOKEN;
    if(!expected || expected.length<32 || !token || Buffer.byteLength(token)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token),Buffer.from(expected))) throw new UnauthorizedException();
    return this.worker.tick();
  }
}
