-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "legal_hold" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rate_buckets" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_buckets_expiresAt_idx" ON "rate_buckets"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- CreateIndex
CREATE INDEX "provider_events_createdAt_idx" ON "provider_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "channels_type_external_id_key" ON "channels"("type", "external_id");
