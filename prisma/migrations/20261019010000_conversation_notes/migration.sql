CREATE TABLE "conversation_notes" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "conversation_id" TEXT NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "author_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "body" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "conversation_notes_conversation_id_created_at_idx" ON "conversation_notes"("conversation_id", "created_at");
