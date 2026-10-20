const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 for(const dir of fs.readdirSync('prisma/migrations').sort())if(fs.existsSync(`prisma/migrations/${dir}/migration.sql`))await db.exec(fs.readFileSync(`prisma/migrations/${dir}/migration.sql`,'utf8'));
 await db.exec(`INSERT INTO plans(id,name,slug) VALUES('p','Plano','plano');
 INSERT INTO tenants(id,name,slug,plan_id,"updatedAt") VALUES('t','Empresa','empresa','p',NOW()),('t2','Outra','outra','p',NOW());
 INSERT INTO channels(id,tenant_id,type,name,"updatedAt") VALUES('ch','t','OFFICIAL_META','Canal',NOW());
 INSERT INTO contacts(id,tenant_id,wa_id) VALUES('ct','t','5531999999999');
 INSERT INTO conversations(id,channel_id,contact_id,"updatedAt") VALUES('c','ch','ct',NOW());`);
 const insert=`INSERT INTO api_deliveries(id,tenant_id,conversation_id,api_key_hash,key_hash,fingerprint,kind,payload,payload_bytes,expires_at,updated_at) VALUES ('j','t','c','a','k','f','TEMPLATE','ciphertext',10,NOW()+INTERVAL '7 days',NOW())`;
 await db.exec(insert);await assert.rejects(db.exec(insert.replace("'j'","'j2'")),/unique/);
 let r=await db.query(`UPDATE api_deliveries SET state='PROCESSING',attempts=attempts+1,lease_until=NOW()+INTERVAL '5 minutes' WHERE id='j' AND state='QUEUED' RETURNING id`);assert.equal(r.rows.length,1);
 r=await db.query(`UPDATE api_deliveries SET state='PROCESSING' WHERE id='j' AND state='QUEUED' RETURNING id`);assert.equal(r.rows.length,0);
 await db.exec(`UPDATE api_deliveries SET lease_until=NOW()-INTERVAL '1 second' WHERE id='j'; UPDATE api_deliveries SET state='REVIEW',payload=NULL,payload_bytes=0 WHERE state='PROCESSING' AND lease_until<NOW();`);
 r=await db.query(`SELECT state,payload,payload_bytes FROM api_deliveries WHERE id='j'`);assert.deepEqual(r.rows[0],{state:'REVIEW',payload:null,payload_bytes:0});
 await db.exec(`DELETE FROM conversations WHERE id='c'`);assert.equal((await db.query('SELECT * FROM api_deliveries')).rows.length,0);
 await db.close();console.log('PASS: full migration chain, idempotency, conditional claim, stale lease and privacy cascade.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
