ALTER TABLE "subscriptions" ADD COLUMN "cancellation_pending" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "canceled_at" TIMESTAMP(3);
