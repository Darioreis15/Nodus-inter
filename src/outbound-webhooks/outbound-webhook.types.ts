export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface WebhookSubscriptionRecord {
  id: string;
  tenantId: string;
  url: string;
  events: unknown;
  secret: string;
  active: boolean;
  createdAt: Date;
}
