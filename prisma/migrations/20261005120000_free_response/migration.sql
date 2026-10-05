ALTER TABLE "conversations" ADD COLUMN "pending_automation" JSONB, ADD COLUMN "automation_completed" BOOLEAN NOT NULL DEFAULT false;
