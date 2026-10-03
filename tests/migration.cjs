// Disposable PostgreSQL/WASM test. NODE_PATH should include @electric-sql/pglite.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '../prisma/migrations');
const migration = fs.readFileSync(`${root}/20261003040000_customer_workspace/migration.sql`, 'utf8');
async function baseline() {
  const db = new PGlite();
  for (const name of ['20260925000000_baseline','20260926000000_security']) await db.exec(fs.readFileSync(`${root}/${name}/migration.sql`,'utf8'));
  await db.exec(`INSERT INTO plans (id,name,slug) VALUES ('p','Test','test');
    INSERT INTO tenants (id,name,slug,plan_id,"updatedAt") VALUES ('t','Test','test','p',NOW());
    INSERT INTO users (id,tenant_id,name,email,password_hash,"updatedAt") VALUES ('u','t','Ana','ANA@EXAMPLE.COM','hash',NOW());`);
  return db;
}
(async()=>{
  const db=await baseline();
  try {
    await db.exec(migration);
    assert.equal((await db.query('SELECT email FROM users')).rows[0].email,'ana@example.com');
    await assert.rejects(db.exec(`INSERT INTO users (id,tenant_id,name,email,password_hash,"updatedAt") VALUES ('u2','t','Other','Ana@Example.com','hash',NOW())`));
    await db.exec(`INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES ('hash','u',NOW());`);
    assert.deepEqual((await db.query('SELECT workspace_settings FROM tenants')).rows[0].workspace_settings,{});
    console.log('Migration: applies all schemas, normalizes emails, rejects case duplicates, creates reset table.');
  } finally { await db.close(); }
  const collision=await baseline();
  try {
    await collision.exec(`INSERT INTO users (id,tenant_id,name,email,password_hash,"updatedAt") VALUES ('u2','t','Other','ana@example.com','hash',NOW())`);
    await assert.rejects(collision.exec(migration),/duplicate case-insensitive/);
    assert.equal((await collision.query('SELECT count(*)::int AS count FROM users')).rows[0].count,2);
    console.log('Migration: existing colliding identities stop migration without merging or deleting users.');
  } finally {await collision.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
