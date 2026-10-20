const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 for(const dir of fs.readdirSync('prisma/migrations').sort()){
  if(dir==='20261020020000_sandbox_billing'){
   await db.exec(`INSERT INTO plans(id,name,slug) VALUES ('p','Plan','plan');
   INSERT INTO tenants(id,name,slug,plan_id,"updatedAt") VALUES ('t','Tenant','tenant','p',NOW());
   INSERT INTO subscriptions(id,tenant_id,asaas_customer_id,status,"updatedAt") VALUES ('s','t','cus','ACTIVE',NOW());
   INSERT INTO billing_cycles(id,subscription_id,month,due_date,value_cents,state,payment_id) VALUES ('paid','s','2026-10','2026-10-10',9900,'CREATED','paid_payment');`);
  }
  const file=`prisma/migrations/${dir}/migration.sql`;if(fs.existsSync(file))await db.exec(fs.readFileSync(file,'utf8'));
 }
 assert.equal((await db.query("SELECT is_test FROM billing_cycles WHERE id='paid'")).rows[0].is_test,false);
 const insert="INSERT INTO billing_cycles(id,subscription_id,month,due_date,value_cents,state,is_test) VALUES ('test','s','test-2026-10-20','2026-10-23',500,'SENDING',true)";
 await db.exec(insert);await assert.rejects(db.exec(insert.replace("'test','s'","'test2','s'")),/unique/);
 assert.deepEqual((await db.query('SELECT id FROM billing_cycles WHERE subscription_id=\'s\' AND is_test=false')).rows,[{id:'paid'}]);
 await db.close();console.log('PASS: migrations preserve paid cycles, isolate tests and enforce one test per subscription/date.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
