ALTER TABLE subscriptions ADD COLUMN delivery_enabled BOOLEAN NOT NULL DEFAULT false, ADD COLUMN delivery_settings JSONB NOT NULL DEFAULT '{}';
CREATE TABLE billing_deliveries (
 id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES billing_cycles(id) ON DELETE CASCADE ON UPDATE CASCADE,
 kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'QUEUED', error TEXT, provider_id TEXT,
 attempted_at TIMESTAMP(3), next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
 UNIQUE(cycle_id,kind)
);
CREATE INDEX billing_deliveries_state_next_attempt_at_idx ON billing_deliveries(state,next_attempt_at);
CREATE TABLE public_attachment_requests (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
 key_hash TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'SENDING', response JSONB,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,key_hash)
);
