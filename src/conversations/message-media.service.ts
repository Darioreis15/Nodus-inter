import { BadGatewayException, Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RateGuard } from '../security/rate.guard';
import { unseal } from '../security/secrets';
import { META_GRAPH_VERSION } from '../channels/connectors/meta-api';
import { MEDIA_MAX_BYTES, MessageMedia, publicMedia, validMediaBytes } from './message-media';

export async function limitedBytes(response: Response, max: number) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new PayloadTooLargeException('Arquivo excede o limite de 10 MB.'); }
  if (!response.body) throw new BadGatewayException('Arquivo indisponivel.');
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
  try { while (true) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new PayloadTooLargeException('Arquivo excede o limite de 10 MB.'); }
    chunks.push(Buffer.from(value));
  } } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export function trustedMetaMediaUrl(value: unknown): string {
  if (typeof value !== 'string') throw new BadGatewayException('URL de midia invalida.');
  let url: URL; try { url = new URL(value); } catch { throw new BadGatewayException('URL de midia invalida.'); }
  // Download endpoint returned by Graph. No webhook/client URLs or redirects allowed.
  if (url.protocol !== 'https:' || url.hostname !== 'lookaside.fbsbx.com' || url.username || url.password || (url.port && url.port !== '443')) throw new BadGatewayException('Origem da midia Meta nao permitida.');
  return url.href;
}
@Injectable()
export class MessageMediaService {
  private activeDownloads = 0;
  constructor(private prisma: PrismaService, private rate: RateGuard) {}
  async download(tenantId: string, conversationId: string, id: string) {
    const message = await this.prisma.message.findFirst({ where: { id, conversationId, conversation: { channel: { tenantId } } }, include: { conversation: { include: { channel: true } } } });
    if (!message || !message.media) throw new NotFoundException('Anexo nao encontrado nesta conversa.');
    await this.rate.consume(`media:${tenantId}`, 30, 60000);
    const media = message.media as unknown as MessageMedia;
    const safe = publicMedia(media);
    if (!safe) throw new UnsupportedMediaTypeException('Formato de arquivo nao suportado.');
    if ((safe.sizeBytes || 0) > MEDIA_MAX_BYTES) throw new PayloadTooLargeException('Arquivo excede o limite de 10 MB.');
    if (this.activeDownloads >= 2) throw new ServiceUnavailableException('Ha outros anexos sendo baixados. Aguarde alguns segundos.');
    this.activeDownloads++;
    try { return await this.fetchFile(message, media, safe); } finally { this.activeDownloads--; }
  }
  private async fetchFile(message: any, media: MessageMedia, safe: MessageMedia) {
    const channel = message.conversation.channel; const config = channel.config as any;
    let buffer: Buffer;
    try {
      if (channel.type === 'QR_EVOLUTION') {
        const base = process.env.EVOLUTION_API_BASE_URL?.replace(/\/$/, '');
        const key = process.env.EVOLUTION_API_KEY;
        if (!base || !key || !config?.instanceName || !message.externalId) throw new BadGatewayException('Canal sem configuracao para recuperar anexo.');
        const response = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instanceName)}`, {
          method:'POST', redirect:'error', signal:AbortSignal.timeout(20000), headers:{apikey:key,'Content-Type':'application/json'},
          body:JSON.stringify({message:{key:{id:message.externalId}},convertToMp4:false}),
        });
        if (!response.ok) throw new BadGatewayException('Anexo indisponivel na Evolution. O arquivo pode ter expirado.');
        const data = JSON.parse((await limitedBytes(response, Math.ceil(MEDIA_MAX_BYTES * 4 / 3) + 65536)).toString('utf8'));
        const base64 = data?.base64;
        if (typeof base64 !== 'string' || base64.length > Math.ceil(MEDIA_MAX_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new BadGatewayException('Resposta de midia invalida.');
        buffer = Buffer.from(base64, 'base64');
      } else {
        if (!media.providerId || !/^\d+$/.test(media.providerId) || !config?.phoneNumberId || config.phoneNumberId !== channel.externalId) throw new NotFoundException('Identificador da midia indisponivel.');
        const token = unseal(config.accessToken, `meta:${config.phoneNumberId}`);
        const headers = {Authorization:`Bearer ${token}`};
        const metadata = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${media.providerId}?phone_number_id=${encodeURIComponent(config.phoneNumberId)}`, {headers, redirect:'error',signal:AbortSignal.timeout(10000)});
        if (!metadata.ok) throw new BadGatewayException('Midia Meta indisponivel. Confira o token do canal ou a validade do arquivo.');
        const data = JSON.parse((await limitedBytes(metadata, 65536)).toString('utf8'));
        if (data.id !== media.providerId) throw new BadGatewayException('Identificador de midia inconsistente.');
        if (Number(data.file_size) > MEDIA_MAX_BYTES) throw new PayloadTooLargeException('Arquivo excede o limite de 10 MB.');
        const response = await fetch(trustedMetaMediaUrl(data.url), {headers,redirect:'error',signal:AbortSignal.timeout(20000)});
        if (!response.ok) throw new BadGatewayException('Arquivo indisponivel na Meta.');
        buffer = await limitedBytes(response, MEDIA_MAX_BYTES);
      }
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof NotFoundException || error instanceof PayloadTooLargeException) throw error;
      throw new BadGatewayException('Nao foi possivel recuperar o arquivo. Tente novamente; arquivos antigos podem ter expirado no provedor.');
    }
    if (!validMediaBytes(buffer, safe.mimeType)) throw new UnsupportedMediaTypeException('Conteudo do arquivo nao corresponde ao formato permitido.');
    return {buffer, ...safe};
  }
}
