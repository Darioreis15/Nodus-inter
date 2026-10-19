ALTER TABLE "conversations" ADD COLUMN "pipeline_stage" TEXT NOT NULL DEFAULT 'QUEUE', ADD COLUMN "reply_due_at" TIMESTAMP(3);
UPDATE "conversations" SET "pipeline_stage" = CASE WHEN status = 'RESOLVED' THEN 'RESOLVED' WHEN status = 'PENDING' THEN 'WAITING' WHEN assigned_user_id IS NOT NULL THEN 'IN_SERVICE' ELSE 'QUEUE' END;
CREATE INDEX "conversations_reply_due_at_idx" ON "conversations"("reply_due_at");
