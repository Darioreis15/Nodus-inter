export type ConversationStatus = 'OPEN' | 'PENDING' | 'RESOLVED';

export interface ContactRecord {
  id: string;
  tenantId: string;
  waId: string;
  name: string | null;
  createdAt: Date;
}

export interface ConversationRecord {
  id: string;
  channelId: string;
  contactId: string;
  assignedUserId: string | null;
  status: ConversationStatus;
  createdAt: Date;
  updatedAt: Date;
}
