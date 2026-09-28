const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const assert = require('assert/strict');
(async () => {
 const db = new PGlite();
 await db.exec(fs.readFileSync('prisma/migrations/20260925000000_baseline/migration.sql', 'utf8'));
 await db.exec("INSERT INTO plans (id,name,slug,\"maxChannels\",\"maxUsers\") VALUES ('p','Starter','starter',1,3); INSERT INTO tenants (id,name,slug,plan_id,\"updatedAt\") VALUES ('t','test','test','p',NOW()); INSERT INTO users (id,tenant_id,name,email,password_hash,\"updatedAt\") VALUES ('u','t','test','test@example.com','hash',NOW());");
 await db.exec(fs.readFileSync('prisma/migrations/20260926000000_security/migration.sql','utf8'));
 const sql = "UPDATE users SET failed_login_count = CASE WHEN locked_until <= NOW() THEN 1 ELSE failed_login_count + 1 END, locked_until = CASE WHEN locked_until <= NOW() THEN NULL WHEN failed_login_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END WHERE id = 'u'";
 for (let i=0;i<5;i++) await db.exec(sql);
 let row=(await db.query("SELECT failed_login_count, locked_until > NOW() AS locked, token_version FROM users WHERE id='u'")).rows[0];
 assert.equal(row.failed_login_count,5); assert.equal(row.locked,true); assert.equal(row.token_version,0);
 await db.exec("UPDATE users SET locked_until=NOW()-INTERVAL '1 minute' WHERE id='u'"); await db.exec(sql);
 row=(await db.query("SELECT failed_login_count, locked_until FROM users WHERE id='u'")).rows[0];
 assert.equal(row.failed_login_count,1); assert.equal(row.locked_until,null);
 await db.close(); console.log('PASS: baseline + upgrade preservam registros; SQL bloqueia na quinta falha e libera apos prazo.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
