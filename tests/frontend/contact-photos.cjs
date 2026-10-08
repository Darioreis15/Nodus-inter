// All API/CDN calls are intercepted; no real contacts or providers are accessed.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../frontend');
const server=http.createServer((req,res)=>{const file=path.resolve(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0].slice(1));if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1440,height:960}});await context.addInitScript(()=>window.NODUS_API_URL='https://api.nodus.test');
 const calls=[],cdn=[];const channel={id:'channel',name:'Atendimento',type:'QR_EVOLUTION',status:'CONNECTED'};
 const conversations=['Ana Souza','Bruno Lima','Carla Dias','Meta Teste'].map((name,i)=>({id:String(i+1),status:'OPEN',contact:{id:'contact'+i,name,waId:'5531999999999'},channel:{...channel,type:i===3?'OFFICIAL_META':'QR_EVOLUTION'}}));
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin===base)return route.continue();
  if(u.hostname==='pps.whatsapp.net'){cdn.push(req.headers());if(u.pathname==='/broken')return route.fulfill({status:404,body:''});return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});}
  if(u.hostname!=='api.nodus.test')return route.abort();const p=u.pathname;let payload={};
  if(p==='/auth/login')payload={accessToken:'session-token'};
  else if(p==='/auth/me')payload={user:{id:'admin',name:'Operador Teste',role:'ADMIN'},tenant:{id:'tenant',status:'ACTIVE'}};
  else if(p==='/conversations')payload=conversations;
  else if(p==='/channels')payload=[channel];
  else if(p==='/users')payload=[];
  else if(p==='/workspace')payload={departments:[],stages:[]};
  else if(p.endsWith('/messages'))payload=[];
  else if(p.endsWith('/photo')){calls.push(p);assert.equal(req.headers().authorization,'Bearer session-token');payload={url:p.includes('/1/')?'https://pps.whatsapp.net/photo':p.includes('/3/')?'https://pps.whatsapp.net/broken':null};}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',err=>errors.push(err.message));
 async function login(){await page.locator('[name=email]').fill('ana@example.com');await page.locator('[name=password]').fill('test-password-123');await page.locator('#login-form button').click();await page.locator('.conversation').first().waitFor();}
 await page.goto(base);await login();
 const first=page.locator('.conversation[data-id="1"]');await first.locator('img').waitFor();await first.click();await page.locator('.chat-header .contact-avatar img').waitFor();
 await page.waitForFunction(()=>!document.querySelector('.conversation[data-id="3"] img'));
 assert.equal(calls.filter(p=>p==='/conversations/1/photo').length,1);assert.ok(!calls.includes('/conversations/4/photo'));
 assert.equal(await page.locator('.conversation[data-id="2"] .avatar').innerText(),'BL');
 assert.ok(cdn.every(h=>!h.authorization&&!h.apikey&&!h.referer));
 await page.screenshot({path:'/tmp/nodus-contact-photos-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/nodus-contact-photos-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.setViewportSize({width:1440,height:960});await page.locator('#logout').click();await page.locator('#login-form').waitFor();await login();await first.locator('img').waitFor();
 assert.equal(calls.filter(p=>p==='/conversations/1/photo').length,2);assert.deepEqual(errors,[]);
 console.log('PASS photos: list/header, private/broken/Meta fallback, shared cache, logout isolation, CDN without credentials, mobile');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
