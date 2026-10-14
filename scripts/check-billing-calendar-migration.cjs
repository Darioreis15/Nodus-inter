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
 await db.close();console.log('PASS: all migrations, legacy preserved, nullable provider ID, unique monthly cycle.');
})().catch(e=>{console.error(e);process.exitCode=1});
