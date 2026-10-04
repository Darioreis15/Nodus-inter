ALTER TABLE users ADD COLUMN is_owner BOOLEAN NOT NULL DEFAULT false;
WITH first_users AS (
 SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY "createdAt", id) AS position FROM users
)
UPDATE users SET is_owner = true, role = 'ADMIN' WHERE id IN (SELECT id FROM first_users WHERE position = 1);
CREATE UNIQUE INDEX users_one_owner_per_tenant ON users(tenant_id) WHERE is_owner;
ALTER TABLE users ADD CONSTRAINT users_owner_is_admin CHECK (NOT is_owner OR role = 'ADMIN');
ALTER TABLE conversations ADD COLUMN department_id TEXT;
ALTER TABLE channels ADD COLUMN auto_reply_department_id TEXT;
