import { metaRequest, META_GRAPH_VERSION, metaErrorInfo } from './meta-api';
import { unseal } from '../../security/secrets';
import { Injectable, BadGatewayException } from '@nestjs/common';
import { ChannelRecord as Channel } from '../channel.types';
import { ChannelConnector, OutboundTextMessage, OutboundMediaMessage, SendResult } from './channel-connector.interface';

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
  async sendMedia(channel:Channel, message:OutboundMediaMessage):Promise<SendResult & {providerId?:string}> {
    const config = channel.config as unknown as MetaConfig;
    const token = unseal(config.accessToken, `meta:${config.phoneNumberId}`);
    const form = new FormData();
    form.append('messaging_product','whatsapp');
    form.append('type',message.media.mimeType);
    form.append('file',new Blob([new Uint8Array(message.buffer)],{type:message.media.mimeType}),message.media.fileName);
    let uploaded: any;
    try {
      const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(config.phoneNumberId)}/media`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,redirect:'error',signal:AbortSignal.timeout(45000)});
      uploaded = await response.json().catch(()=>null);
      if (!response.ok || uploaded?.error) throw new BadGatewayException(metaErrorInfo(uploaded?.error).message);
      if (typeof uploaded?.id !== 'string' || !/^\d+$/.test(uploaded.id)) throw new BadGatewayException('A Meta nao retornou identificador do arquivo.');
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Nao foi possivel carregar o arquivo na Meta.');
    }
    const kind = message.media.kind;
    const data = await metaRequest(`${encodeURIComponent(config.phoneNumberId)}/messages`,token,{
      messaging_product:'whatsapp',to:message.to,type:kind,
      [kind]:{id:uploaded.id,...(message.caption ? {caption:message.caption} : {}),...(kind==='document' ? {filename:message.media.fileName} : {})},
    });
    if (typeof data?.messages?.[0]?.id !== 'string' || !data.messages[0].id) throw new BadGatewayException('Meta sem confirmacao do envio. Confira a conversa antes de repetir.');
    return {externalId:data.messages[0].id,providerId:uploaded.id};
  }

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
