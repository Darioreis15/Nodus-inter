ALTER TABLE subscriptions ALTER COLUMN asaas_subscription_id DROP NOT NULL;
ALTER TABLE subscriptions ADD COLUMN billing_options JSONB NOT NULL DEFAULT '{}', ADD COLUMN calendar_enabled BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN billing_price_cents INTEGER, ADD COLUMN billing_start_month TEXT, ADD COLUMN calendar_error TEXT;
CREATE TABLE billing_cycles (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
 month TEXT NOT NULL, due_date TEXT NOT NULL, value_cents INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'READY', payment_id TEXT UNIQUE, attempted_at TIMESTAMP(3), error TEXT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(subscription_id, month)
);
