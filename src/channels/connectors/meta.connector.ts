import { metaRequest } from './meta-api';
import { unseal } from '../../security/secrets';
import { Injectable, BadGatewayException } from '@nestjs/common';
import { ChannelRecord as Channel } from '../channel.types';
import { ChannelConnector, OutboundTextMessage, SendResult } from './channel-connector.interface';

interface MetaConfig {
  phoneNumberId: string;
  accessToken: string;
  wabaId?: string;
}


/**
 * Cliente para a Cloud API oficial da Meta. Diferente da Evolution API,
 * aqui nao existe "criar instancia" -- o numero ja precisa estar
 * verificado no WhatsApp Business Manager antes, e o admin so cola o
 * phoneNumberId + accessToken na hora de cadastrar o canal.
 */
@Injectable()
export class MetaConnector implements ChannelConnector {
  async sendTemplate(channel: Channel, to: string, template: { name: string; language: string; parameters: string[] }): Promise<SendResult> {
    const config = channel.config as unknown as MetaConfig;
    const data = await metaRequest(`${encodeURIComponent(config.phoneNumberId)}/messages`,
      unseal(config.accessToken, `meta:${config.phoneNumberId}`), {
        messaging_product: 'whatsapp', to, type: 'template', template: {
          name: template.name, language: { code: template.language },
          ...(template.parameters.length ? { components: [{ type: 'body', parameters: template.parameters.map(text => ({ type: 'text', text })) }] } : {}),
        },
      });
    if (typeof data?.messages?.[0]?.id !== 'string') throw new BadGatewayException('Meta nao retornou ID da mensagem.');
    return { externalId: data.messages[0].id };
  }

  async sendText(channel: Channel, message: OutboundTextMessage): Promise<SendResult> {
    const config = channel.config as unknown as MetaConfig;

    const data = await metaRequest(
      `${encodeURIComponent(config.phoneNumberId)}/messages`,
      unseal(config.accessToken, `meta:${config.phoneNumberId}`),
      { messaging_product: 'whatsapp', to: message.to, type: 'text', text: { body: message.text } },
    );
    if (typeof data?.messages?.[0]?.id !== 'string' || !data.messages[0].id) {
      throw new BadGatewayException('Resposta da Meta sem identificador da mensagem. Entrega nao confirmada.');
    }
    return { externalId: data.messages[0].id };
  }
}
