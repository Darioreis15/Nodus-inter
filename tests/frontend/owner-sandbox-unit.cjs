const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map();
const element=()=>({value:'',textContent:'',checked:false,disabled:false,hidden:false,open:false,children:[],reset(){},addEventListener(){},replaceChildren(){this.children=[];},append(...a){this.children.push(...a);},showModal(){this.open=true;},close(){this.open=false;},focus(){}});
for(const match of fs.readFileSync('frontend/owner/index.html','utf8').matchAll(/id="([^"]+)"/g))elements.set(match[1],element());
let available=true,calls=0,whatsappCalls=0,accept=false;
const context=vm.createContext({document:{getElementById:id=>{assert(elements.has(id),`missing ${id}`);return elements.get(id);},createElement:element},Option:function(){return element();},Intl,URLSearchParams,encodeURIComponent,confirm:()=>accept,fetch:async(url,opts)=>{
 if(url.endsWith('/sandbox-whatsapp')){whatsappCalls++;assert.deepEqual(JSON.parse(opts.body),{currentPassword:'password',confirmation:'SANDBOX_WHATSAPP',cycleId:'cycle',expectedPhone:'5531999999999',expectedChannelId:'channel'});return{ok:true,json:async()=>({whatsappState:'SENT'})};}
 if(url.endsWith('/sandbox-billing')){calls++;assert.equal(JSON.parse(opts.body).expectedEmail,'test@example.com');return{ok:true,json:async()=>({emailState:'SENT'})};}
 assert(url.endsWith('/delivery'));
 return{ok:true,json:async()=>({enabled:true,settings:{emailEnabled:true,email:'test@example.com',whatsappEnabled:true,phone:'5531999999999',channelId:'channel'},channels:[{id:'channel',type:'QR_EVOLUTION',status:'CONNECTED',name:'Test'}],history:[],workerEnabled:true,emailReady:true,billingType:'BOLETO',sandboxTest:{available,cycleId:'cycle',date:'2026-10-20',valueCents:500}})};
}});
vm.runInContext(fs.readFileSync('frontend/owner/owner.js','utf8'),context);
(async()=>{
 await vm.runInContext("token='test';openDelivery({id:'tenant',name:'Test'})",context);
 assert.equal(elements.get('sandboxBillingSection').hidden,false);
 await elements.get('sandboxBilling').onclick();assert.match(elements.get('sandboxBillingResult').textContent,/senha/);assert.equal(calls,0);
 elements.get('deliveryPassword').value='password';await elements.get('sandboxBilling').onclick();assert.equal(calls,0);
 accept=true;await elements.get('sandboxBilling').onclick();assert.equal(calls,1);assert.match(elements.get('sandboxBillingResult').textContent,/Aceito/);assert.equal(elements.get('deliveryPassword').value,'');
 assert.equal(elements.get('sandboxWhatsapp').disabled,false);
 accept=false;elements.get('deliveryPassword').value='password';await elements.get('sandboxWhatsapp').onclick();assert.equal(whatsappCalls,0);
 accept=true;await elements.get('sandboxWhatsapp').onclick();assert.equal(whatsappCalls,1);assert.equal(calls,1);assert.equal(elements.get('deliveryPassword').value,'');assert.match(elements.get('sandboxBillingResult').textContent,/WhatsApp/);
 available=false;await vm.runInContext("openDelivery({id:'tenant',name:'Test'})",context);assert.equal(elements.get('sandboxBillingSection').hidden,true);
 console.log('PASS: Owner DOM bindings, password, confirmation, request, feedback, password clearing, production hiding.');
})().catch(e=>{console.error(e);process.exitCode=1;});
