const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(fs.readFileSync('prisma/migrations/20260925000000_baseline/migration.sql','utf8'));
 await db.exec(fs.readFileSync('prisma/migrations/20261019010000_conversation_notes/migration.sql','utf8'));
 await db.exec(`INSERT INTO plans(id,name,slug) VALUES('p','Plano','plano');
 INSERT INTO tenants(id,name,slug,plan_id,"updatedAt") VALUES('t','Empresa','empresa','p',NOW());
 INSERT INTO users(id,tenant_id,name,email,password_hash,"updatedAt") VALUES('u','t','Operador','x@example.com','hash',NOW());
 INSERT INTO channels(id,tenant_id,type,name,"updatedAt") VALUES('ch','t','QR_EVOLUTION','Canal',NOW());
 INSERT INTO contacts(id,tenant_id,wa_id) VALUES('ct','t','551111111111');
 INSERT INTO conversations(id,channel_id,contact_id,"updatedAt") VALUES('c','ch','ct',NOW());
 INSERT INTO conversation_notes(id,conversation_id,author_id,body) VALUES('n','c','u','Controle interno');
 DELETE FROM users WHERE id='u';`);
 assert.equal((await db.query('SELECT author_id FROM conversation_notes')).rows[0].author_id,null);
 await db.exec("DELETE FROM conversations WHERE id='c'");
 assert.equal((await db.query('SELECT * FROM conversation_notes')).rows.length,0);
 await db.close();console.log('PASS: notes migration, removed author, cascading erasure.');
})().catch(e=>{console.error(e);process.exitCode=1});
