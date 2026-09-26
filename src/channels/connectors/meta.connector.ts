import { unseal } from '../../security/secrets';
import { Injectable, BadGatewayException } from '@nestjs/common';
import { ChannelRecord as Channel } from '../channel.types';
import { ChannelConnector, OutboundTextMessage, SendResult } from './channel-connector.interface';

interface MetaConfig {
  phoneNumberId: string;
  accessToken: string;
  wabaId?: string;
}

const GRAPH_API_VERSION = 'v20.0';

/**
 * Cliente para a Cloud API oficial da Meta. Diferente da Evolution API,
 * aqui nao existe "criar instancia" -- o numero ja precisa estar
 * verificado no WhatsApp Business Manager antes, e o admin so cola o
 * phoneNumberId + accessToken na hora de cadastrar o canal.
 */
@Injectable()
export class MetaConnector implements ChannelConnector {
  async sendText(channel: Channel, message: OutboundTextMessage): Promise<SendResult> {
    const config = channel.config as unknown as MetaConfig;

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${config.phoneNumberId}/messages`,
      {
        signal: AbortSignal.timeout(10000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${unseal(config.accessToken, `meta:${config.phoneNumberId}`)}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'text',
          text: { body: message.text },
        }),
      },
    );

    const data = await response.json();
    if (!response.ok) {
      throw new BadGatewayException(
        `Falha ao enviar mensagem via Cloud API da Meta: HTTP ${response.status}`,
      );
    }

    return { externalId: data.messages?.[0]?.id ?? `meta-${Date.now()}` };
  }
}
