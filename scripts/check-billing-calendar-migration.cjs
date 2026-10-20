const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const assert = require('assert/strict');
(async()=>{
 const db=new PGlite();
 for(const dir of fs.readdirSync('prisma/migrations').filter(p=>/^\d/.test(p)).sort()){
   if(dir==='20261015000000_billing_calendar'){
     await db.exec(`INSERT INTO plans(id,name,slug,"maxChannels","maxUsers") VALUES('plan','Demo','demo',1,3);
     INSERT INTO tenants(id,name,slug,plan_id,"updatedAt") VALUES('tenant','Demo','demo','plan',NOW());
     INSERT INTO subscriptions(id,tenant_id,asaas_customer_id,asaas_subscription_id,status,"updatedAt") VALUES('sub','tenant','cus','remote','ACTIVE',NOW());`);
   }
   await db.exec(fs.readFileSync(`prisma/migrations/${dir}/migration.sql`,'utf8'));
 }
 let row=(await db.query("SELECT calendar_enabled,asaas_subscription_id FROM subscriptions WHERE id='sub'")).rows[0];
 assert.equal(row.calendar_enabled,false);assert.equal(row.asaas_subscription_id,'remote');
 await db.exec("UPDATE subscriptions SET asaas_subscription_id=NULL WHERE id='sub'; INSERT INTO billing_cycles(id,subscription_id,month,due_date,value_cents) VALUES('c','sub','2026-11','2026-11-10',9900)");
 await assert.rejects(()=>db.exec("INSERT INTO billing_cycles(id,subscription_id,month,due_date,value_cents) VALUES('c2','sub','2026-11','2026-11-10',9900)"));
 row=(await db.query("SELECT delivery_enabled,delivery_settings FROM subscriptions WHERE id='sub'")).rows[0];
 assert.equal(row.delivery_enabled,false);assert.deepEqual(row.delivery_settings,{});
 await db.exec("INSERT INTO billing_deliveries(id,cycle_id,kind,updated_at) VALUES('d','c','EMAIL',NOW()); INSERT INTO public_attachment_requests(id,tenant_id,key_hash,fingerprint) VALUES('r','tenant','hash','digest')");
 await assert.rejects(()=>db.exec("INSERT INTO billing_deliveries(id,cycle_id,kind,updated_at) VALUES('d2','c','EMAIL',NOW())"));
 await assert.rejects(()=>db.exec("INSERT INTO public_attachment_requests(id,tenant_id,key_hash,fingerprint) VALUES('r2','tenant','hash','digest')"));
 await db.exec("DELETE FROM billing_cycles WHERE id='c'");
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM billing_deliveries')).rows[0].n,0);
 await db.exec("DELETE FROM subscriptions WHERE id='sub'; DELETE FROM tenants WHERE id='tenant'");
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM public_attachment_requests')).rows[0].n,0);
 await db.close();console.log('PASS: all migrations, legacy preserved, nullable provider ID, unique monthly cycle, unique deliveries/idempotency, cascade cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
