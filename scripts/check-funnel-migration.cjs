const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
const db=new PGlite();await db.exec(fs.readFileSync('prisma/migrations/20260925000000_baseline/migration.sql','utf8'));
await db.exec(`INSERT INTO plans(id,name,slug) VALUES('p','Plano','plano');
INSERT INTO tenants(id,name,slug,plan_id,"updatedAt") VALUES('t','Empresa','empresa','p',NOW());
INSERT INTO users(id,tenant_id,name,email,password_hash,"updatedAt") VALUES('u','t','Operador','x@example.com','hash',NOW());
INSERT INTO channels(id,tenant_id,type,name,"updatedAt") VALUES('ch','t','QR_EVOLUTION','Canal',NOW());
INSERT INTO contacts(id,tenant_id,wa_id) VALUES('ct','t','551111111111');
INSERT INTO conversations(id,channel_id,contact_id,status,assigned_user_id,"updatedAt") VALUES('queue','ch','ct','OPEN',NULL,NOW()),('service','ch','ct','OPEN','u',NOW()),('wait','ch','ct','PENDING','u',NOW()),('done','ch','ct','RESOLVED','u',NOW());`);
await db.exec(fs.readFileSync('prisma/migrations/20261019020000_automatic_funnel/migration.sql','utf8'));
const rows=(await db.query('SELECT id,pipeline_stage,reply_due_at FROM conversations ORDER BY id')).rows;
assert.deepEqual(rows.map(r=>[r.id,r.pipeline_stage]),[['done','RESOLVED'],['queue','QUEUE'],['service','IN_SERVICE'],['wait','WAITING']]);assert(rows.every(r=>r.reply_due_at===null));
await db.exec(`UPDATE conversations SET reply_due_at='2026-10-19T10:10:00' WHERE id='service';`);
const before=await db.query(`UPDATE conversations SET pipeline_stage='WAITING',reply_due_at=NULL WHERE reply_due_at<='2026-10-19T10:09:59' RETURNING id`);assert.equal(before.rows.length,0);
const due=await db.query(`UPDATE conversations SET pipeline_stage='WAITING',reply_due_at=NULL WHERE reply_due_at<='2026-10-19T10:10:00' AND status!='RESOLVED' RETURNING id`);assert.deepEqual(due.rows.map(r=>r.id),['service']);
await db.close();console.log('PASS: existing conversations migrate, deadline persists and respects cutoff.');
})().catch(e=>{console.error(e);process.exitCode=1});
