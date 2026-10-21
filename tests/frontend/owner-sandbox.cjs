const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('frontend/owner');
const server=http.createServer((req,res)=>{const name=req.url.split('?')[0].slice(1)||'index.html';if(!['index.html','owner.js','owner.css'].includes(name)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,name)));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});let calls=0,available=true;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.origin===origin)return route.continue();
   if(u.hostname!=='nodus-inter.onrender.com')return route.abort();
   let body;
   if(u.pathname.endsWith('/sandbox-billing')){calls++;const data=route.request().postDataJSON();assert.equal(data.confirmation,'SANDBOX_EMAIL');assert.equal(data.expectedEmail,'test@example.com');body={test:true,emailState:'SENT',valueCents:500};}
   else if(u.pathname.endsWith('/delivery'))body={enabled:true,settings:{emailEnabled:true,email:'test@example.com'},channels:[],history:[],workerEnabled:true,emailReady:true,billingType:'BOLETO',sandboxTest:{available,date:'2026-10-20',valueCents:500}};
   else return route.abort();
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(origin);await page.evaluate(()=>{token='test-token';return openDelivery({id:'tenant',name:'Empresa de teste'});});
  await page.locator('#sandboxBilling').click();assert.match(await page.locator('#sandboxBillingResult').textContent(),/senha/);assert.equal(calls,0);
  await page.locator('#deliveryPassword').fill('correct');page.once('dialog',d=>d.dismiss());await page.locator('#sandboxBilling').click();assert.equal(calls,0);
  page.once('dialog',d=>d.accept());await page.locator('#sandboxBilling').click();await page.waitForFunction(()=>document.getElementById('sandboxBillingResult').textContent.includes('Aceito'));assert.equal(calls,1);assert.equal(await page.locator('#deliveryPassword').inputValue(),'');
  await page.locator('#sandboxBillingSection').screenshot({path:'/tmp/nodus-sandbox-owner.png'});
  available=false;await page.locator('#refreshDelivery').click();await page.waitForFunction(()=>document.getElementById('sandboxBillingSection').hidden);assert.deepEqual(errors,[]);
  console.log('PASS: owner sandbox controls, password, cancel, saved recipient, response, secret clearing and production visibility.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
