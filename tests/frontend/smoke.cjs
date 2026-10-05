// Run with PLAYWRIGHT_BROWSERS_PATH and NODE_PATH pointing at your Playwright installation.
// Every API response is simulated. No call can reach Render, Meta, Asaas or Evolution.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../frontend');
const screenshotDir = process.env.NODUS_SCREENSHOTS || '/tmp/nodus-screenshots';
fs.mkdirSync(screenshotDir, { recursive:true });
const id = '11111111-1111-4111-8111-111111111111';
let channels = [{ id, name:'Atendimento principal', type:'QR_EVOLUTION', status:'CONNECTED', phoneNumber:'+55 31 99999-0000', autoReplyEnabled:true, autoReplyMessage:'Olá, como podemos ajudar?' }];
let user = { name:'Ana Oliveira', role:'ADMIN', email:'ana@example.com', id:'admin' };
let tenantStatus = 'ACTIVE', forced = false;
let conv = [{ id:'conversation', status:'OPEN', contact:{ name:'Mariana Costa', waId:'5531999990000' }, channel:channels[0], lastMessage:{ body:'Olá! Gostaria de saber mais.', createdAt:new Date().toISOString() } }];
let messages = [{ id:'msg', body:'Olá! Gostaria de saber mais.', direction:'INBOUND', status:'RECEIVED', createdAt:new Date().toISOString() }];
let createCalls=0, loginEmail, logoutNext=false, requests=[];
const settings = { timezone:'America/Sao_Paulo', businessHours:{ enabled:true, days:[1,2,3,4,5], start:'08:00',end:'18:00' }, awayMessage:'Estamos fora do expediente.', stages:[{ id:'22222222-2222-4222-8222-222222222222',name:'Comercial',keyword:'vendas',message:'Vamos ajudar.' }] };
const server = http.createServer((req,res) => {
  const name = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
  const file = path.resolve(root,name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(404); return res.end(); }
  try { res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'); res.end(fs.readFileSync(file)); } catch {res.writeHead(404);res.end();}
});
(async () => {
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless:true, args:['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport:{width:1440,height:960} });
    await context.addInitScript(() => { window.NODUS_API_URL = 'https://api.nodus.test'; });
    await context.route('**/*', async route => {
      const req=route.request(), url=new URL(req.url());
      if (url.origin === base) return route.continue();
      if (url.hostname !== 'api.nodus.test') return route.abort();
      const p=url.pathname, method=req.method(), data=req.postDataJSON();requests.push({p,method,data});
      let payload={},status=200;
      if(p==='/auth/login'){loginEmail=data.email;payload={accessToken:'test-token',mustChangePassword:forced};}
      else if(p==='/auth/me')payload={user,tenant:{status:tenantStatus}};
      else if(p==='/auth/change-password'){forced=false;payload={message:'ok'};}
      else if(p==='/auth/forgot-password')payload={message:'Se existir uma conta, enviaremos as instruções.'};
      else if(p==='/channels'&&method==='POST'){createCalls++;const c={...data,id:'new-channel',status:'PENDING'};channels.push(c);payload=c;}
      else if(p==='/channels')payload=channels;
      else if(p.endsWith('/qrcode'))payload={base64:'" onerror="alert(1)',status:'unknown'};
      else if(p==='/conversations'&&method==='POST')payload={id:'conversation',status:'OPEN'};
      else if(p==='/conversations')payload= url.searchParams.get('status')==='RESOLVED' ? [{...conv[0],status:'RESOLVED',resolvedByName:'Ana Oliveira',resolvedAt:new Date().toISOString()}] : conv;
      else if(p.endsWith('/messages')&&method==='POST'){payload={...messages[0],id:'sent',body:data.text,direction:'OUTBOUND',status:'SENT'};messages.push(payload);}
      else if(p.endsWith('/messages'))payload=messages;
      else if(p==='/workspace')payload=settings;
      else if(p==='/users'&&method==='POST')payload={...data,temporaryPassword:data.temporaryPassword||'one-time-password'};
      else if(p==='/users/limits')payload={used:1,maxUsers:3,available:2,planName:'Starter'};
      else if(p==='/users')payload=[{...user,availability:{available:true}}];
      else if(p==='/api-keys'&&method==='POST')payload={key:'nodus_live_test',name:data.name};
      else if(p==='/api-keys')payload=[];
      else if(p==='/billing/status')payload={tenantStatus,plan:{name:'Pro',priceCents:29900},subscription:{status:'ACTIVE'}};
      else if(p==='/billing/payments')payload={data:[{id:'pay',value:299,status:'RECEIVED',dueDate:'2026-10-10',invoiceUrl:'https://sandbox.asaas.com/i/test'}],totalCount:1,hasMore:false};
      else if(p==='/reports/summary')payload={conversationsByStatus:{OPEN:2,PENDING:1,RESOLVED:3},messagesLast7Days:[]};
      else if(p.endsWith('/contact'))conv[0].contact.name=data.name;
      if(logoutNext&&p==='/channels'){status=401;payload={message:'Unauthorized'};logoutNext=false;}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(payload),headers:{'Access-Control-Allow-Origin':'*'}});
    });
    const page=await context.newPage(), errors=[];page.on('pageerror',err=>{errors.push(err.message);console.log('PAGEERROR',err.message)}); page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
    async function login(){await page.locator('[name=email]').fill('ANA@EXAMPLE.COM');await page.locator('[name=password]').fill('test-password-123');await page.locator('#login-form button').click();}
    await page.goto(base);await page.screenshot({path:path.join(screenshotDir,'login.png')});await login();
    await page.locator('.conversation').first().waitFor({timeout:5000}).catch(async e=>{console.log('REQUESTS',requests);console.log('BODY',await page.locator('body').innerText());throw e});assert.equal(loginEmail,'ana@example.com');assert.equal(await page.evaluate(()=>localStorage.getItem('nodus_token')),null);
    await page.locator('.conversation').first().click();await page.locator('#message-form textarea').fill('<img src=x onerror=alert(1)>');await page.locator('#message-form button').click();
    await page.getByText('<img src=x onerror=alert(1)>',{exact:true}).first().waitFor();assert.equal(await page.locator('#messages img').count(),0);
    await page.screenshot({path:path.join(screenshotDir,'inbox.png')});
    await page.locator('[data-page=connections]').click();await page.getByRole('tab',{name:'Novo canal',exact:true}).click();await page.locator('#channel-form [name=name]').fill('Comercial');await page.locator('#channel-form button').click();await page.getByText('Comercial',{exact:true}).waitFor();assert.equal(createCalls,1);
    await page.getByRole('tab',{name:'Novo canal',exact:true}).click();await page.locator('#channel-form [name=name]').fill('Suporte');await page.locator('#channel-form button').click();await page.getByText('Suporte',{exact:true}).waitFor();assert.equal(createCalls,2);
    await page.screenshot({path:path.join(screenshotDir,'connections.png')});
    await page.locator('[data-action=qr]').first().click();await page.getByText(/QR Code indisponível/).waitFor();assert.equal(await page.locator('#modal img').count(),0);await page.locator('.modal-close').click();
    await page.locator('[data-page=settings]').click();await page.getByRole('tab',{name:'Expediente',exact:true}).click();await page.locator('#settings-form').waitFor();await page.locator('#settings-form [type=submit]').click();await page.getByText('Configurações salvas.',{exact:true}).waitFor();
    await page.locator('#chat').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(screenshotDir,'settings.png')});
    await page.locator('[data-page=users]').click();await page.getByRole('tab',{name:'Novo operador',exact:true}).click();await page.locator('#user-form [name=name]').fill('Operador');await page.locator('#user-form [name=email]').fill('op@example.com');await page.locator('#user-form [name=temporaryPassword]').fill('Temporary-12345');await page.locator('#user-form button').click();await page.locator('#secret-value').waitFor();assert.equal(await page.locator('#secret-value').inputValue(),'Temporary-12345');await page.locator('.modal-close').click();
    await page.locator('[data-page=logs]').click();await page.getByText('Finalizado por:',{exact:false}).first().waitFor();
    await page.locator('[data-page=billing]').click();await page.getByText('1 de 1 cobranças carregadas',{exact:false}).waitFor();await page.screenshot({path:path.join(screenshotDir,'billing.png')});
    await page.setViewportSize({width:390,height:844});await page.locator('[data-page=connections]').click();await page.getByRole('tab',{name:'Meus canais',exact:true}).waitFor();await page.screenshot({path:path.join(screenshotDir,'mobile-connections.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile overflow');
    await page.locator('[data-filter=OPEN]').click();await page.locator('.conversation').first().click();await page.locator('#message-form').waitFor();assert.ok(await page.locator('#message-form').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),'mobile composer must fit viewport');await page.screenshot({path:path.join(screenshotDir,'mobile-chat.png')});
    await page.setViewportSize({width:1440,height:960});
    logoutNext=true;await page.locator('[data-page=connections]').click();await page.locator('#login-form').waitFor();
    forced=true;await login();await page.locator('#password-form').waitFor();await page.locator('[name=currentPassword]').fill('temporary');await page.locator('[name=newPassword]').fill('New-password-123');await page.locator('#password-form button').click();await page.locator('#login-form').waitFor();
    tenantStatus='SUSPENDED';await login();await page.locator('#payments-list').waitFor();assert.equal(await page.locator('[data-filter=OPEN]').count(),0);
    await page.locator('#logout').click();user.role='AGENT';tenantStatus='ACTIVE';await login();await page.locator('.conversation').first().waitFor();assert.equal(await page.locator('[data-page=connections]').count(),0);
    assert.deepEqual(errors,[]);console.log('Frontend smoke passed: login, XSS, create twice without reload, QR sanitization, settings, temporary password, logs, billing, mobile, expired session, forced password change, suspended admin, agent navigation.');
  } finally {await browser.close();server.close();}
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
