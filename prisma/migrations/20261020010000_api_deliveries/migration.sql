ALTER TABLE "tenants" ADD COLUMN "api_dispatch_after" TIMESTAMP(3);
CREATE TABLE "api_deliveries" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "conversation_id" TEXT NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "api_key_hash" TEXT NOT NULL,
 "key_hash" TEXT NOT NULL,
 "fingerprint" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'QUEUED',
 "payload" TEXT,
 "payload_bytes" INTEGER NOT NULL CHECK ("payload_bytes" >= 0),
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expires_at" TIMESTAMP(3) NOT NULL,
 "lease_until" TIMESTAMP(3),
 "message_id" TEXT,
 "error_code" TEXT,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "api_deliveries_tenant_id_key_hash_key" ON "api_deliveries"("tenant_id","key_hash");
CREATE INDEX "api_deliveries_state_next_attempt_at_idx" ON "api_deliveries"("state","next_attempt_at");
CREATE INDEX "api_deliveries_tenant_id_created_at_id_idx" ON "api_deliveries"("tenant_id","created_at","id");
CREATE INDEX "api_deliveries_conversation_id_idx" ON "api_deliveries"("conversation_id");
