// Run from cron with environment loaded from a protected file. Never log tokens.
const base=process.env.NODUS_API_BASE_URL, token=process.env.FUNNEL_RUN_TOKEN;
if(!base || !base.startsWith('https://') || !token || token.length<32){console.error('Configure NODUS_API_BASE_URL HTTPS e FUNNEL_RUN_TOKEN.');process.exitCode=1;}
else fetch(base.replace(/\/$/,'')+'/internal/funnel/run',{method:'POST',headers:{'x-funnel-run-token':token},redirect:'error',signal:AbortSignal.timeout(55000)})
.then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);console.log(JSON.stringify(await r.json()));})
.catch(()=>{console.error('Falha ao processar funil; verificar disponibilidade do backend.');process.exitCode=1;});
