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
let user = { name:'Ana Oliveira', role:'ADMIN', email:'ana@example.com', id:'admin', isOwner:true };
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
      else if(p==='/auth/change-email')payload={updated:true};
      else if(p==='/campaigns')payload=method==='POST'?{id:'campaign'}:{workerEnabled:false,campaigns:[]};
      else if(p==='/auth/change-password'){forced=false;payload={message:'ok'};}
      else if(p==='/auth/forgot-password')payload={message:'Se existir uma conta, enviaremos as instruções.'};
      else if(p==='/channels'&&method==='POST'){createCalls++;const c={...data,id:'new-channel',status:'PENDING'};channels.push(c);payload=c;}
      else if(p==='/channels')payload=channels;
      else if(p.endsWith('/qrcode'))payload={base64:'" onerror="alert(1)',status:'unknown'};
      else if(p==='/conversations'&&method==='POST')payload={id:'conversation',status:'OPEN'};
      else if(p==='/conversations')payload= url.searchParams.get('status')==='RESOLVED' ? [{...conv[0],status:'RESOLVED',resolvedByName:'Ana Oliveira',resolvedAt:new Date().toISOString()}] : conv;
      else if(p.endsWith('/messages')&&method==='POST'){payload={...messages[0],id:'sent',body:data.text,direction:'OUTBOUND',status:'SENT'};messages.push(payload);}
      else if(p.endsWith('/messages'))payload=messages;
      else if(p==='/workspace'){if(method==='PATCH')Object.assign(settings,data);payload=settings;}
      else if(p==='/users'&&method==='POST')payload={...data,temporaryPassword:data.temporaryPassword||'one-time-password'};
      else if(p==='/users/limits')payload={used:1,maxUsers:3,available:2,planName:'Starter'};
      else if(p==='/users')payload=[{...user,availability:{available:true}},{id:'secondary',name:'Carlos',email:'carlos@example.com',role:'ADMIN',isOwner:false}];
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
    await page.goto(base);await login();await page.locator('.conversation').first().waitFor();
    await page.locator('[data-page=users]').click();await page.getByText('Administrador principal · protegido',{exact:false}).waitFor();
    assert.equal(await page.locator('[data-role-user="admin"]').count(),0);assert.equal(await page.locator('[data-delete-user="admin"]').count(),0);
    await page.locator('[data-role-user="secondary"]').click();await page.locator('#role-form [name=role]').selectOption('AGENT');await page.locator('#role-form button').click();await page.locator('#modal').waitFor({state:'hidden'});
    assert.ok(requests.some(r=>r.p==='/users/secondary/role'&&r.data.role==='AGENT'));
    await page.locator('[data-page=settings]').click();await page.locator('#account-password-form').waitFor();
    await page.screenshot({path:path.join(screenshotDir,'account-settings-v9.png')});
    await page.locator('[data-page=automations]').click();await page.locator('#department-form').waitFor();
    await page.locator('#add-department').click();await page.locator('#department-fields input').fill('Financeiro');await page.locator('#department-form button.primary').click();await page.getByText('Setores salvos.',{exact:false}).waitFor();
    const dept=settings.departments[0].id;
    await page.locator('#add-stage').click();const second=page.locator('.stage-editor').nth(1);
    await second.locator('[data-field=name]').fill('Atendimento financeiro');await second.locator('[data-field=keyword]').fill('1');await second.locator('[data-field=message]').fill('Encaminhando para Ana.');
    await second.locator('[data-field=fromStageId]').selectOption(settings.stages[0].id);await second.locator('[data-field=departmentId]').selectOption(dept);await second.locator('[data-field=userId]').selectOption('admin');
    await page.locator('#automations-form button.primary').click();await page.getByText('Automações salvas.',{exact:true}).waitFor();
    assert.equal(settings.stages[1].fromStageId,settings.stages[0].id);assert.equal(settings.stages[1].departmentId,dept);assert.equal(settings.stages[1].userId,'admin');
    await page.locator('[data-auto-channel]').click();await page.locator('#auto-form [name=departmentId]').selectOption(dept);await page.locator('#auto-form button').click();await page.locator('#modal').waitFor({state:'hidden'});
    assert.ok(requests.some(r=>r.p.endsWith('/auto-reply')&&r.data.departmentId===dept));
    await page.locator('#chat').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(screenshotDir,'automations-v9.png')});
    await page.locator('[data-page=campaigns]').click();await page.locator('#campaign-form').waitFor();
    await page.locator('#campaign-form [name=name]').fill('Boletos de teste');await page.locator('#campaign-form [name=recipients]').fill('5511999999999;Ana;https://example.com/boleto/123;99,00');
    await page.locator('[data-step=text]').fill('Olá {{nome}}, boleto {{link}}, valor {{valor}}. Responda SAIR.');await page.locator('#add-campaign-step').click();await page.locator('.campaign-step').nth(1).locator('[data-step=text]').fill('Lembrete {{nome}}');await page.locator('[name=consentConfirmed]').check();
    await page.locator('#campaign-form button.primary').click();await page.locator('#confirm-campaign').waitFor();assert.ok(!requests.some(r=>r.p==='/campaigns'&&r.method==='POST'));
    await page.locator('#confirm-campaign').click();await page.locator('#modal').waitFor({state:'hidden'});
    const sent=requests.find(r=>r.p==='/campaigns'&&r.method==='POST').data;
    assert.equal(sent.steps.length,2);assert.equal(sent.recipients[0].link,'https://example.com/boleto/123');assert.equal(sent.stopOnReply,true);
    await page.locator('#chat').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(screenshotDir,'campaigns-v9.png')});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(screenshotDir,'campaigns-mobile-v9.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.setViewportSize({width:1440,height:960});await page.locator('[data-page=settings]').click();await page.locator('#email-form [name=email]').fill('new@example.com');await page.locator('#email-form [name=confirmation]').fill('new@example.com');await page.locator('#email-form [name=currentPassword]').fill('Current-password');await page.locator('#email-form button').click();await page.locator('#login-form').waitFor();
    user.role='AGENT';await login();await page.locator('[data-page=settings]').click();await page.locator('#account-password-form').waitFor();assert.equal(await page.locator('#settings-form').count(),0);assert.equal(await page.locator('[data-page=campaigns]').count(),0);
    assert.deepEqual(errors,[]);console.log('PASS UI: protected owner, admin role change, departments, conditional steps, welcome routing, campaign confirmation/payload, mobile, email change and agent account settings.');
  } finally {await browser.close();server.close();}
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
