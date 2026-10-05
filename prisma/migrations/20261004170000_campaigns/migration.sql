ALTER TABLE tenants ADD COLUMN dispatch_clock TIMESTAMP(3);
CREATE TABLE campaigns (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, name TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'ACTIVE', request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, stop_on_reply BOOLEAN NOT NULL DEFAULT true,
 source_key_hash TEXT, UNIQUE(tenant_id, request_key)
);
CREATE INDEX campaigns_tenant_id_created_at_idx ON campaigns(tenant_id, created_at);
CREATE TABLE campaign_deliveries (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, step INTEGER NOT NULL,
 due_at TIMESTAMP(3) NOT NULL, status TEXT NOT NULL DEFAULT 'QUEUED', payload JSONB NOT NULL,
 message_id TEXT, error TEXT, started_at TIMESTAMP(3), finished_at TIMESTAMP(3), UNIQUE(campaign_id, contact_id, step)
);
CREATE INDEX campaign_deliveries_status_due_at_idx ON campaign_deliveries(status,due_at);
CREATE TABLE campaign_suppressions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 phone_hash TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,phone_hash)
);
