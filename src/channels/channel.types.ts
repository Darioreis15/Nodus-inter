export type ChannelType = 'QR_EVOLUTION' | 'OFFICIAL_META';
export type ChannelStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED';

export interface ChannelRecord {
  id: string;
  tenantId: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  externalId: string | null;
  config: unknown;
  autoReplyEnabled: boolean;
  autoReplyMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
