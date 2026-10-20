// Continuous runner for Contabo. One call processes at most one queued job.
// Use a protected systemd EnvironmentFile; do not put secrets in arguments.
const base=process.env.NODUS_API_BASE_URL,token=process.env.API_QUEUE_RUN_TOKEN;
let url;
try{url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();}catch{console.error('Configure NODUS_API_BASE_URL como origem HTTPS.');process.exit(1);}
if(!token||token.length<32){console.error('Configure API_QUEUE_RUN_TOKEN com pelo menos 32 caracteres.');process.exit(1);}
let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 while(!stopped){
  let delay=1000;
  try{
   const response=await fetch(`${url.origin}/internal/api-deliveries/run`,{method:'POST',headers:{'x-api-queue-token':token},redirect:'error',signal:AbortSignal.timeout(90000)});
   if(response.status===401||response.status===403){console.error('Autenticacao recusada; runner encerrado.');process.exitCode=1;break;}
   const result=await response.json().catch(()=>({}));
   if(!response.ok){delay=Math.max(1000,Math.min(3600000,Number(result.retryAfter||30)*1000));console.error(`Fila API: HTTP ${response.status}; nova tentativa posterior.`);}
   else if(result.enabled===false){delay=30000;}
   else if(result.processed){console.log('Fila API: item processado.');}
  }catch{delay=30000;console.error('Fila API: resposta indisponivel. O backend preserva envios incertos para revisao.');}
  if(!stopped)await wait(delay);
 }
})();
