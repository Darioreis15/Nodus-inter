import { Injectable, BadGatewayException } from '@nestjs/common';
import { ChannelRecord as Channel } from '../channel.types';
import { ChannelConnector, OutboundTextMessage, OutboundMediaMessage, SendResult } from './channel-connector.interface';

interface EvolutionConfig {
  instanceName: string;
}

/**
 * Cliente para a Evolution API (self-hosted, baseada em Baileys) -- o
 * caminho "QR Code" de conexao com o WhatsApp.
 *
 * Endpoints e formato de payload seguem a Evolution API v2
 * (https://github.com/EvolutionAPI/evolution-api). Como o projeto evolui
 * rapido, vale conferir a doc antes de apontar pra uma instancia em
 * producao -- isso aqui cobre o fluxo basico de criar instancia, buscar
 * QR code e mandar texto.
 */
@Injectable()
export class EvolutionConnector implements ChannelConnector {
  async sendMedia(channel: Channel, message: OutboundMediaMessage): Promise<SendResult & {providerId?:string}> {
    const config = channel.config as unknown as EvolutionConfig;
    if (!config?.instanceName) throw new BadGatewayException('Instancia Evolution nao configurada.');
    try {
      const response = await fetch(`${this.baseUrl}/message/sendMedia/${encodeURIComponent(config.instanceName)}`, {
        method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
        headers:{apikey:this.globalApiKey,'Content-Type':'application/json'},
        body:JSON.stringify({number:message.to,mediatype:message.media.kind,mimetype:message.media.mimeType,caption:message.caption,fileName:message.media.fileName,media:message.buffer.toString('base64')}),
      });
      if (!response.ok) throw new BadGatewayException('A Evolution recusou o arquivo. Confira o canal antes de tentar novamente.');
      const data = await response.json(); const id = data?.key?.id || data?.messageId;
      if (typeof id !== 'string' || !id || id.length > 512) throw new BadGatewayException('Evolution sem confirmacao do envio. Confira o WhatsApp antes de repetir.');
      return {externalId:id};
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Falha de comunicacao no envio. Confira o WhatsApp antes de repetir para evitar duplicidade.');
    }
  }

  private get baseUrl(): string {
    const url = process.env.EVOLUTION_API_BASE_URL;
    if (!url) {
      throw new BadGatewayException('EVOLUTION_API_BASE_URL nao configurada.');
    }
    return url.replace(/\/$/, '');
  }

  private get globalApiKey(): string {
    const key = process.env.EVOLUTION_API_KEY;
    if (!key) {
      throw new BadGatewayException('EVOLUTION_API_KEY nao configurada.');
    }
    return key;
  }

  /**
   * Cria a instancia na Evolution API e ja registra o webhook desse
   * channel especifico -- e assim que os eventos (mensagem recebida,
   * status da conexao) voltam pro nosso backend.
   */
  async createInstance(instanceName: string, webhookUrl: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/instance/create`, {
      signal: AbortSignal.timeout(10000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.globalApiKey },
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: { enabled: true, headers: { 'x-evolution-token': process.env.EVOLUTION_WEBHOOK_TOKEN }, url: webhookUrl, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(`Falha ao criar instancia na Evolution API: HTTP ${response.status}`);
    }
  }

  async syncWebhook(instanceName: string, webhookUrl: string) {
    if (!process.env.EVOLUTION_WEBHOOK_TOKEN) throw new BadGatewayException('Token do webhook Evolution nao configurado.');
    const response = await fetch(`${this.baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{apikey:this.globalApiKey,'Content-Type':'application/json'},
      body:JSON.stringify({webhook:{enabled:true,url:webhookUrl,headers:{'x-evolution-token':process.env.EVOLUTION_WEBHOOK_TOKEN},byEvents:false,base64:false,events:['MESSAGES_UPSERT','MESSAGES_UPDATE','CONNECTION_UPDATE']}}),
    });
    if (!response.ok) throw new BadGatewayException('Nao foi possivel atualizar os eventos do webhook Evolution.');
    return {updated:true};
  }

  async getQrCode(instanceName: string): Promise<{ base64?: string; status: string }> {
    const response = await fetch(`${this.baseUrl}/instance/connect/${instanceName}`, {
      signal: AbortSignal.timeout(10000),
      headers: { apikey: this.globalApiKey },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(`Falha ao buscar QR code: HTTP ${response.status}`);
    }

    const data = await response.json();
    return { base64: data.base64 ?? data.qrcode?.base64, status: data.instance?.state ?? 'unknown' };
  }

  async deleteInstance(instanceName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/instance/delete/${instanceName}`, {
      signal: AbortSignal.timeout(10000),
      method: 'DELETE',
      headers: { apikey: this.globalApiKey },
    });
    // 404 aqui significa que a instancia ja nao existe mais na Evolution API
    // (por exemplo, se ela nunca terminou de conectar) -- nao e erro de verdade.
    if (!response.ok && response.status !== 404) {
      const detail = await response.text();
      throw new BadGatewayException(`Falha ao deletar instancia na Evolution API: HTTP ${response.status}`);
    }
  }

  private async instanceRequest(path: string, method = 'GET') {
    const response = await fetch(`${this.baseUrl}/instance/${path}`, {
      method, signal: AbortSignal.timeout(10000), redirect: 'error',
      headers: { apikey: this.globalApiKey },
    });
    if (!response.ok) throw new BadGatewayException(`Evolution recusou a operacao: HTTP ${response.status}`);
    return response.json().catch(() => ({}));
  }

  async connection(instanceName: string) {
    const name = encodeURIComponent(instanceName);
    const data = await this.instanceRequest(`fetchInstances?instanceName=${name}`);
    const entries = Array.isArray(data) ? data : [];
    const entry = entries.find((e: any) => (e.name || e.instance?.instanceName || e.instance?.name) === instanceName);
    if (!entry) return { status: 'DISCONNECTED' as const, phoneNumber: null };
    const instance = entry.instance || entry;
    const state = instance.connectionStatus || instance.status || instance.state;
    const jid = instance.ownerJid || instance.owner || '';
    return { status: state === 'open' ? 'CONNECTED' as const : 'DISCONNECTED' as const,
      phoneNumber: typeof jid === 'string' ? jid.split('@')[0].split(':')[0] || null : null };
  }

  async disconnect(instanceName: string) {
    await this.instanceRequest(`logout/${encodeURIComponent(instanceName)}`, 'DELETE');
  }

  async restart(instanceName: string) {
    await this.instanceRequest(`restart/${encodeURIComponent(instanceName)}`, 'POST');
  }

  async profilePicture(instanceName: string, number: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json', apikey: this.globalApiKey },
        body: JSON.stringify({ number }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return typeof data?.profilePictureUrl === 'string' ? data.profilePictureUrl : null;
    } catch { return null; } // Missing/private photos and provider outages never block a conversation.
  }

  async sendText(channel: Channel, message: OutboundTextMessage): Promise<SendResult> {
    const config = channel.config as unknown as EvolutionConfig;
    const response = await fetch(`${this.baseUrl}/message/sendText/${config.instanceName}`, {
      signal: AbortSignal.timeout(10000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.globalApiKey },
      body: JSON.stringify({ number: message.to, text: message.text }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(`Falha ao enviar mensagem via Evolution API: HTTP ${response.status}`);
    }

    const data = await response.json();
    return { externalId: data.key?.id ?? data.messageId ?? `evo-${Date.now()}` };
  }
}
