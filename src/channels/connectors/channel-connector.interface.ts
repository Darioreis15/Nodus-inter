import { ChannelRecord as Channel } from '../channel.types';

export interface OutboundTextMessage {
  to: string;
  text: string;
}

export interface SendResult {
  externalId: string;
}

/**
 * Contrato unico que o resto do sistema usa pra falar com o WhatsApp,
 * seja a instancia rodando via QR Code (Evolution API) ou via API oficial
 * da Meta. Nem o ChannelsService nem quem chama /channels/:id/messages
 * precisa saber qual dos dois esta por tras -- so o connector sabe.
 */
export interface ChannelConnector {
  sendText(channel: Channel, message: OutboundTextMessage): Promise<SendResult>;
}
