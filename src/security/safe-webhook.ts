import { lookup } from 'dns/promises';
import { request } from 'https';
import * as ipaddr from 'ipaddr.js';
import { BadRequestException } from '@nestjs/common';

export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function resolveWebhook(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new BadRequestException('Webhook exige HTTPS publico na porta 443.');
  let timer: ReturnType<typeof setTimeout>;
  const addresses = await Promise.race([
    lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }),
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 3000); }),
  ]).finally(() => clearTimeout(timer!));
  if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new BadRequestException('Destino privado/reservado nao permitido.');
  return { url, address: addresses[0] };
}
export async function deliverWebhook(raw: string, body: string, headers: Record<string, string>): Promise<number> {
  const { url, address } = await resolveWebhook(raw);
  // DNS fixado durante a conexao; sem redirecionamentos ou uma segunda resolucao.
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers, lookup: (_host, options: any, cb: any) => options.all ? cb(null, [address]) : cb(null, address.address, address.family) }, res => {
      const status = res.statusCode || 500;
      res.destroy();
      resolve(status);
    });
    const timer = setTimeout(() => req.destroy(new Error('Timeout de webhook')), 5000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(body);
  });
}
