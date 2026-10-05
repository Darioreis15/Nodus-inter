import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { CampaignDto, CampaignRecipientDto, CampaignStepDto } from './campaigns.dto';
export const phoneHash = (tenantId: string, phone: string) => createHash('sha256').update(`${tenantId}:${phone}`).digest('hex');
export function renderStep(step: CampaignStepDto, recipient: CampaignRecipientDto): CampaignStepDto {
  const values: Record<string,string> = { nome:recipient.name || '', link:recipient.link || '', valor:recipient.value || '' };
  const render = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!(key in values) || !values[key]) throw new BadRequestException(`Variavel sem valor: ${key}.`);
    return values[key];
  });
  const result = step.type === 'TEXT' ? { ...step, text:render(step.text || '') } : { ...step, template:{ ...step.template!, parameters:step.template!.parameters.map(render) } };
  if ((result.text?.length || 0) > 4000 || result.template?.parameters.some(p => p.length > 1024)) throw new BadRequestException('Mensagem personalizada excede o limite.');
  return result;
}
@Injectable()
export class CampaignsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(CampaignsService.name);
  constructor(private prisma: PrismaService, private conversations: ConversationsService) {}
  onModuleInit() {
    if (process.env.CAMPAIGNS_WORKER_ENABLED === 'true') {
      this.timer = setInterval(() => void this.tick(), 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async create(tenantId: string, dto: CampaignDto, sourceKeyHash?: string) {
    if (!dto.consentConfirmed) throw new BadRequestException('Confirme a autorizacao dos destinatarios.');
    const scheduledAt = new Date(dto.scheduledAt);
    if (new Set(dto.recipients.map(r => r.phone)).size !== dto.recipients.length) throw new BadRequestException('Destinatarios duplicados.');
    if (dto.steps.some((s,i) => (i > 0 && s.delayMinutes <= dto.steps[i-1].delayMinutes) || (s.type === 'TEXT' ? !s.text?.trim() || !!s.template : !s.template || !!s.text))) throw new BadRequestException('Etapas devem ter intervalos crescentes e apenas texto ou template.');
    const payloads = dto.recipients.map(r => dto.steps.map(s => renderStep(s,r)));
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const existing = await tx.campaign.findUnique({ where: { tenantId_requestKey:{ tenantId, requestKey:dto.requestKey } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('requestKey ja usado com outro conteudo.');
        return { id:existing.id, reused:true };
      }
      if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() > Date.now()+366*86400000 || scheduledAt.getTime() < Date.now()-300000) throw new BadRequestException('Agende entre agora e os proximos 366 dias.');
      const tenant = await tx.tenant.findUniqueOrThrow({ where:{ id:tenantId } });
      if (tenant.status !== 'ACTIVE') throw new ForbiddenException('Empresa suspensa.');
      const channel = await tx.channel.findFirst({ where:{ id:dto.channelId, tenantId } });
      if (!channel) throw new NotFoundException('Canal nao encontrado.');
      if (channel.type === 'OFFICIAL_META' && dto.steps.some(s => s.type !== 'TEMPLATE')) throw new BadRequestException('Campanhas e follow-ups Meta exigem templates aprovados.');
      if (channel.type !== 'OFFICIAL_META' && dto.steps.some(s => s.type !== 'TEXT')) throw new BadRequestException('Templates sao exclusivos da Meta.');
      const pending = await tx.campaignDelivery.count({ where:{ campaign:{ tenantId }, status:{ in:['QUEUED','SENDING'] } } });
      if (pending + dto.recipients.length*dto.steps.length > 5000) throw new ForbiddenException('Limite de 5000 envios pendentes por empresa.');
      const campaign = await tx.campaign.create({ data:{ tenantId, channelId:dto.channelId, name:dto.name, requestKey:dto.requestKey, requestHash, stopOnReply:dto.stopOnReply, sourceKeyHash } });
      for (let i=0;i<dto.recipients.length;i++) {
        const r = dto.recipients[i];
        const blocked = await tx.campaignSuppression.findUnique({ where:{ tenantId_phoneHash:{ tenantId, phoneHash:phoneHash(tenantId,r.phone) } } });
        const contact = await tx.contact.upsert({ where:{ tenantId_waId:{ tenantId, waId:r.phone } }, create:{ tenantId, waId:r.phone, name:r.name || null }, update:{} });
        await tx.campaignDelivery.createMany({ data:payloads[i].map((payload,step) => ({ campaignId:campaign.id, contactId:contact.id, step, dueAt:new Date(scheduledAt.getTime()+payload.delayMinutes*60000), payload:blocked ? {} : JSON.parse(JSON.stringify(payload)), finishedAt:blocked ? new Date() : null, status:blocked ? 'SKIPPED' : 'QUEUED', error:blocked ? 'Destinatario optou por sair.' : null })) });
      }
      await tx.auditEvent.create({data:{tenantId,action:`campaign.created:consent_confirmed:${campaign.id}`}});
      return { id:campaign.id, reused:false, total:dto.recipients.length*dto.steps.length };
    }, { timeout:30000 });
  }
  async list(tenantId: string) {
    const campaigns = await this.prisma.campaign.findMany({ where:{ tenantId }, orderBy:{ createdAt:'desc' }, take:100, select:{ id:true,name:true,state:true,createdAt:true,channelId:true,stopOnReply:true,_count:{select:{deliveries:true}} } });
    return { workerEnabled:process.env.CAMPAIGNS_WORKER_ENABLED === 'true', campaigns };
  }
  async detail(tenantId: string, id: string, cursor?: string) {
    const campaign = await this.prisma.campaign.findFirst({ where:{ id,tenantId }, select:{id:true,name:true,state:true} });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada.');
    const deliveries = await this.prisma.campaignDelivery.findMany({ where:{campaignId:id,...(cursor ? {id:{gt:cursor}} : {})},orderBy:{id:'asc'},take:100,select:{id:true,step:true,dueAt:true,status:true,error:true,messageId:true,contact:{select:{name:true,waId:true}}} });
    const messages = await this.prisma.message.findMany({where:{ id:{in:deliveries.map(d => d.messageId).filter(Boolean) as string[]},conversation:{channel:{tenantId}}},select:{id:true,status:true}});
    return { campaign, deliveries:deliveries.map(d => ({...d, deliveryStatus:messages.find(m => m.id === d.messageId)?.status || null})), nextCursor:deliveries.length === 100 ? deliveries[99].id : null };
  }
  async state(tenantId: string, id: string, state: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const c = await tx.campaign.findFirst({where:{id,tenantId}});
      if (!c) throw new NotFoundException('Campanha nao encontrada.');
      if (c.state === 'CANCELLED') throw new ConflictException('Campanha cancelada nao pode ser reativada.');
      await tx.campaign.update({where:{id},data:{state}});
      if (state === 'CANCELLED') await tx.campaignDelivery.updateMany({where:{campaignId:id,status:'QUEUED'},data:{status:'CANCELLED',payload:{},finishedAt:new Date()}});
      await tx.auditEvent.create({data:{tenantId,action:`campaign.${state.toLowerCase()}:${id}`}});
      return {id,state};
    });
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // A send whose outcome is uncertain must never be retried automatically.
      await this.prisma.campaignDelivery.updateMany({where:{status:'SENDING',startedAt:{lt:new Date(Date.now()-600000)}},data:{status:'UNKNOWN',error:'Envio interrompido. Confira o provedor antes de reenviar.',payload:{},finishedAt:new Date()}});
      const candidates = await this.prisma.campaignDelivery.findMany({ where:{status:'QUEUED',dueAt:{lte:new Date()},campaign:{state:'ACTIVE',tenant:{status:'ACTIVE'},channel:{status:'CONNECTED'}}},orderBy:{dueAt:'asc'},take:20,select:{id:true,campaign:{select:{tenantId:true}}} });
      for (const candidate of candidates) {
        const job = await this.claim(candidate.id,candidate.campaign.tenantId);
        if (!job) continue;
        await this.deliver(job);
        break; // conservative throughput: one send per worker tick; database also paces each tenant.
      }
    } catch { this.logger.warn('Fila de campanhas indisponivel. Proximo ciclo tentara ler novamente.'); }
    finally { this.running = false; }
  }
  async claim(id: string, tenantId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const tenant = await tx.tenant.findUniqueOrThrow({where:{id:tenantId}});
      if (tenant.status !== 'ACTIVE' || (tenant.dispatchClock && tenant.dispatchClock > new Date())) return null;
      const job = await tx.campaignDelivery.findFirst({where:{id,status:'QUEUED',dueAt:{lte:new Date()},campaign:{tenantId,state:'ACTIVE',channel:{status:'CONNECTED'}}},include:{campaign:true,contact:true}});
      if (!job) return null;
      let reason: string | null = null;
      if (job.campaign.sourceKeyHash && !await tx.apiKey.findFirst({where:{tenantId,keyHash:job.campaign.sourceKeyHash,revokedAt:null}})) reason = 'Chave de API revogada.';
      if (await tx.campaignSuppression.findUnique({where:{tenantId_phoneHash:{tenantId,phoneHash:phoneHash(tenantId,job.contact.waId)}}})) reason = 'Destinatario optou por sair.';
      if (job.campaign.stopOnReply && await tx.message.findFirst({where:{direction:'INBOUND',createdAt:{gt:job.campaign.createdAt},conversation:{contactId:job.contactId,channelId:job.campaign.channelId}}})) reason = 'Cliente respondeu; sequencia interrompida.';
      if (job.step > 0) {
        const previous = await tx.campaignDelivery.findUnique({where:{campaignId_contactId_step:{campaignId:job.campaignId,contactId:job.contactId,step:job.step-1}}});
        if (previous && ['QUEUED','SENDING'].includes(previous.status)) return null;
        if (previous?.status !== 'SENT') reason = 'Etapa anterior nao enviada.';
        else if (previous.messageId) {
          const message = await tx.message.findUnique({where:{id:previous.messageId}});
          if (message?.status === 'FAILED') reason = 'Etapa anterior falhou no provedor.';
        }
      }
      if (reason) { await tx.campaignDelivery.update({where:{id},data:{status:'SKIPPED',error:reason,payload:{},finishedAt:new Date()}}); return null; }
      await tx.tenant.update({where:{id:tenantId},data:{dispatchClock:new Date(Date.now()+5000)}});
      await tx.campaignDelivery.update({where:{id},data:{status:'SENDING',startedAt:new Date()}});
      return job;
    });
  }
  async deliver(job: any) {
    const tenantId = job.campaign.tenantId;
    // A cancellation may occur after claim; check again immediately before sending.
    const active = await this.prisma.campaignDelivery.findFirst({where:{id:job.id,status:'SENDING',campaign:{state:'ACTIVE',tenant:{status:'ACTIVE'},channel:{status:'CONNECTED'}}}});
    if (!active) { await this.prisma.campaignDelivery.updateMany({where:{id:job.id,status:'SENDING'},data:{status:'SKIPPED',payload:{},error:'Envio interrompido antes do despacho.',finishedAt:new Date()}}); return; }
    try {
      const conversation = await this.conversations.start(tenantId,{channelId:job.campaign.channelId,phone:job.contact.waId});
      const p = job.payload as CampaignStepDto;
      const message = p.type === 'TEMPLATE' ? await this.conversations.sendTemplate(tenantId,conversation.id,p.template!) : await this.conversations.sendMessage(tenantId,conversation.id,p.text!);
      await this.prisma.campaignDelivery.update({where:{id:job.id},data:{status:'SENT',messageId:message.id,payload:{},finishedAt:new Date()}});
    } catch (error) {
      const response = (error as any)?.getResponse?.();
      const code = typeof response === 'object' && Number.isInteger(response?.providerCode) ? ` Codigo Meta: ${response.providerCode}.` : '';
      await this.prisma.campaignDelivery.updateMany({where:{id:job.id,status:'SENDING'},data:{status:'UNKNOWN',payload:{},finishedAt:new Date(),error:`Envio nao confirmado.${code} Verifique o provedor antes de repetir.`}});
    }
  }
}
