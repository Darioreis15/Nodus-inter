-- Abort rather than merging two identities differing only by email case.
DO $$ BEGIN
 IF EXISTS (SELECT lower(trim(email)) FROM users GROUP BY lower(trim(email)) HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Resolve duplicate case-insensitive user emails before applying this migration';
 END IF;
END $$;
UPDATE users SET email = lower(trim(email));
CREATE UNIQUE INDEX users_email_normalized_key ON users (lower(trim(email)));
ALTER TABLE tenants ADD COLUMN workspace_settings JSONB NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN availability JSONB NOT NULL DEFAULT '{}';
ALTER TABLE conversations ADD COLUMN resolved_by_name TEXT, ADD COLUMN resolved_by_id TEXT,
 ADD COLUMN resolved_at TIMESTAMP(3), ADD COLUMN funnel_stage TEXT;
CREATE TABLE password_resets (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMP(3) NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX password_resets_expires_at_idx ON password_resets(expires_at);
