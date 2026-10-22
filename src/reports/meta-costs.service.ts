import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { metaRequest } from '../channels/connectors/meta-api';
import { unseal } from '../security/secrets';

export function costPeriod(month: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Informe o mes no formato AAAA-MM.');
  const [year, m] = month.split('-').map(Number);
  const start = Date.UTC(year, m - 1, 1), end = Date.UTC(year, m, 1);
  const earliest = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1);
  if (start < earliest || start > now.getTime()) throw new BadRequestException('Selecione um dos ultimos 12 meses.');
  return { start: Math.floor(start / 1000), end: Math.floor(Math.min(end, now.getTime()) / 1000) };
}

export function parseMetaCosts(data: any, phone: string) {
  const groups = data?.pricing_analytics?.data;
  if (!Array.isArray(groups) || data?.pricing_analytics?.paging?.next) throw new BadGatewayException('A Meta nao retornou um relatorio completo de custos.');
  const currency = /^[A-Z]{3}$/.test(data.currency) ? data.currency : null;
  const rows: Array<{date:string;category:string;pricingType:string;volume:number|null;cost:number|null}> = [];
  const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  for (const group of groups) {
    if (!Array.isArray(group.data_points) || group.paging?.next) throw new BadGatewayException('Relatorio Meta incompleto.');
    for (const point of group.data_points) {
      // Defence in depth: never expose another phone's data, even if Meta ignores filters.
      if (typeof point.phone_number !== 'string' || point.phone_number.replace(/\D/g, '') !== phone) continue;
      if (!Number.isFinite(point.start) || point.start < 0 || point.start > 4102444800) throw new BadGatewayException('Periodo invalido no relatorio Meta.');
      rows.push({ date: new Date(point.start * 1000).toISOString().slice(0,10), category: String(point.pricing_category || 'UNKNOWN').slice(0,60), pricingType: String(point.pricing_type || 'UNKNOWN').slice(0,60), volume: numeric(point.volume), cost: numeric(point.cost) });
    }
  }
  // No rows, missing currency, or hidden COST must never become a fabricated zero.
  const costAvailable = !!currency && rows.length > 0 && rows.every(r => r.cost !== null);
  return { currency, costAvailable, totalCost: costAvailable ? rows.reduce((sum,r) => sum + r.cost!,0) : null,
    totalVolume: rows.length && rows.every(r => r.volume !== null) ? rows.reduce((sum,r) => sum + r.volume!,0) : null,
    rows: rows.sort((a,b) => b.date.localeCompare(a.date)), availability: !rows.length ? 'NO_DATA' : costAvailable ? 'AVAILABLE' : 'COST_UNAVAILABLE' };
}

@Injectable()
export class MetaCostsService {
  private cache = new Map<string, {until:number;result:Promise<any>}>();
  constructor(private prisma: PrismaService) {}

  private async owned(tenantId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({where:{id:channelId,tenantId,type:'OFFICIAL_META'}});
    if (!channel) throw new NotFoundException('Canal oficial nao encontrado.');
    const config = channel.config as any;
    if (!/^\d+$/.test(config?.phoneNumberId) || typeof config?.accessToken !== 'string') throw new BadRequestException('Revise a conexao oficial e seu token.');
    return {channel,config,token:unseal(config.accessToken,`meta:${config.phoneNumberId}`)};
  }

  private async verifyWaba(wabaId:string, phoneId:string, token:string) {
    let after: string | undefined;
    for (let page=0;page<10;page++) {
      const query = new URLSearchParams({fields:'id',limit:'100',...(after ? {after} : {})});
      const data = await metaRequest(`${wabaId}/phone_numbers?${query}`,token);
      if (data?.data?.some((p:any) => p.id === phoneId)) return;
      after = data?.paging?.cursors?.after;
      if (!data?.paging?.next || typeof after !== 'string') break;
    }
    throw new BadRequestException('O numero do canal nao foi localizado nesta conta Meta. Confira o WABA ID e as permissoes.');
  }

  async configure(tenantId:string,channelId:string,wabaId:string) {
    const {config,token} = await this.owned(tenantId,channelId);
    await this.verifyWaba(wabaId,config.phoneNumberId,token);
    // Lock and re-read: never overwrite a concurrently rotated access token.
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const current = await tx.channel.findFirst({where:{id:channelId,tenantId,type:'OFFICIAL_META'}});
      if (!current) throw new NotFoundException('Canal nao encontrado.');
      const latest = current.config as any;
      if (latest.phoneNumberId !== config.phoneNumberId || latest.accessToken !== config.accessToken) throw new BadRequestException('A conexao mudou. Tente salvar novamente.');
      await tx.channel.update({where:{id:channelId},data:{config:{...latest,wabaId}}});
    });
    this.cache.clear();
    return {updated:true};
  }

  async get(tenantId:string,channelId:string,month:string) {
    const period = costPeriod(month);
    const {channel,config,token} = await this.owned(tenantId,channelId);
    if (!/^\d+$/.test(config.wabaId || '')) throw new BadRequestException('Configure a conta Meta (WABA ID) para consultar gastos.');
    const key = `${tenantId}:${channel.id}:${month}:${config.wabaId}:${createHash('sha256').update(config.accessToken).digest('hex')}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.result;
    for (const [k,v] of this.cache) if (v.until <= Date.now()) this.cache.delete(k);
    if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
    const result = this.load(channel,config,token,month,period);
    this.cache.set(key,{until:Date.now()+300000,result});
    try { return await result; } catch (error) { this.cache.delete(key); throw error; }
  }

  private async load(channel:any,config:any,token:string,month:string,period:{start:number;end:number}) {
    await this.verifyWaba(config.wabaId,config.phoneNumberId,token);
    const identity = await metaRequest(`${config.phoneNumberId}?fields=id,display_phone_number`,token);
    const phone = typeof identity?.display_phone_number === 'string' ? identity.display_phone_number.replace(/\D/g,'') : '';
    if (identity?.id !== config.phoneNumberId || !/^\d{8,15}$/.test(phone)) throw new BadGatewayException('Nao foi possivel identificar o numero para consultar gastos.');
    const fields = `currency,pricing_analytics.start(${period.start}).end(${period.end}).granularity(DAILY).phone_numbers(${JSON.stringify([phone])}).metric_types(["COST","VOLUME"]).dimensions(["PHONE","PRICING_CATEGORY","PRICING_TYPE"])`;
    const data = await metaRequest(`${config.wabaId}?${new URLSearchParams({fields})}`,token);
    return {channelId:channel.id,channelName:channel.name,phone,month,timezone:'UTC',source:'META_PRICING_ANALYTICS',approximate:true,updatedAt:new Date().toISOString(),...parseMetaCosts(data,phone)};
  }
}
