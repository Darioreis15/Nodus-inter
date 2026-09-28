import { Injectable, BadGatewayException } from '@nestjs/common';
import { ChannelRecord as Channel } from '../channel.types';
import { ChannelConnector, OutboundTextMessage, SendResult } from './channel-connector.interface';

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
        webhook: { enabled: true, headers: { 'x-evolution-token': process.env.EVOLUTION_WEBHOOK_TOKEN }, url: webhookUrl, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(`Falha ao criar instancia na Evolution API: HTTP ${response.status}`);
    }
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
