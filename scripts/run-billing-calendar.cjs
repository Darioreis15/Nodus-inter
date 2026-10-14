'use strict';
// Run hourly from Contabo or a paid scheduler. Node >=20; secrets only in server environment.
const base = process.env.NODUS_API_URL || 'https://nodus-inter.onrender.com';
const token = process.env.BILLING_RUN_TOKEN;
if (!base.startsWith('https://') || !token || token.length < 32) { console.error('Configure HTTPS NODUS_API_URL e BILLING_RUN_TOKEN (32+ caracteres).'); process.exit(1); }
fetch(base.replace(/\/$/, '') + '/billing/calendar/run', {
  method: 'POST', headers: { 'x-billing-run-token': token }, signal: AbortSignal.timeout(600000), redirect: 'error',
}).then(async response => {
  const data = await response.json().catch(()=>({}));
  if (!response.ok || data.errors || data.enabled === false) { console.error('Calendario: falha ou desativado; consulte o painel.', response.status); process.exitCode=1; }
  else console.log('Calendario executado', { date: data.date, processed: data.processed, running: data.running });
}).catch(()=>{ console.error('Execucao nao confirmada. Verifique o painel antes de emitir cobrancas manualmente.'); process.exitCode=1; });
