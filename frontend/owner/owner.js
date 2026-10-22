'use strict';
// Public backend URL only. Never place secrets or the owner's ID here.
const API = 'https://nodus-inter.onrender.com';
const $ = id => document.getElementById(id);
let token = '', plans = [], cursor = null, selection = null, busy = false, openingContract = false, creatingCompany = false, createdCompany = null;
const money = cents => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(cents/100);
const labels = {ACTIVE:'Ativo',SUSPENDED:'Suspenso',PENDING:'Pendente',OVERDUE:'Em atraso',CANCELED:'Encerrado'};
async function api(path, options = {}) {
  const response = await fetch(API + path, {...options, headers: {'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token}:{}),...options.headers}, cache:'no-store'});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {
    if (response.status === 401 && token) signOut();
    throw new Error(data.code === 'CANCELLATION_PENDING' ? 'Acesso suspenso, mas o Asaas ainda não confirmou. Atualize a lista e use “Repetir cancelamento”.' : Array.isArray(data.message) ? data.message.join(' ') : data.message || 'Não foi possível concluir a operação.');
  }
  return data;
}
function signOut() { $('deliveryDialog').close();$('deliveryForm').reset();$('deliveryHistory').replaceChildren();deliverySelection=null; clearCompanyResult();$('companyDialog').close();$('companyForm').reset();token=''; selection=null; $('dashboard').hidden=true; $('loginPanel').hidden=false; $('logout').hidden=true; $('companies').replaceChildren(); $('action').close(); $('confirmPassword').value=''; }
$('logout').onclick=signOut;
$('login').onsubmit=async event=>{
  event.preventDefault(); const button=event.submitter; button.disabled=true; $('notice').textContent='Entrando…';
  try { const data=await api('/auth/login',{method:'POST',body:JSON.stringify({email:$('email').value.trim().toLowerCase(),password:$('password').value})}); token=data.accessToken;
    await api('/owner/me'); $('loginPanel').hidden=true; $('dashboard').hidden=false; $('logout').hidden=false;
    plans=await api('/owner/plans'); await load(false);
  } catch(error) { signOut(); $('notice').textContent=error.message; }
  finally { $('password').value=''; button.disabled=false; }
};
function cell(row,text,tag='td') {const el=document.createElement(tag);el.textContent=text;row.append(el);return el;}
async function load(append) {
  if(busy)return; busy=true; $('notice').textContent='Carregando empresas…'; $('more').disabled=true;
  try {
    const query=new URLSearchParams(); if($('search').value.trim())query.set('search',$('search').value.trim());if($('status').value)query.set('status',$('status').value);if(append&&cursor)query.set('cursor',cursor);
    const [result,summary,calendar]=await Promise.all([api('/owner/tenants?'+query),api('/owner/summary'),api('/owner/billing-calendar')]);
    $('calendarStatus').textContent = `${calendar.enabled ? "Ativado" : "Aguardando ativação no servidor"} · ${calendar.enabledContracts} contratos no calendário · ${calendar.migrationPending} aguardando migração · ${calendar.emissionPending} emissões para conciliar`;
    $('metrics').replaceChildren();for(const [key,title] of Object.entries({total:'Empresas cadastradas',active:'Empresas ativas',suspended:'Empresas suspensas',pendingCancellation:'Cancelamentos pendentes'})){const box=document.createElement('div');box.className='metric';box.textContent=title;const n=document.createElement('strong');n.textContent=summary[key];box.append(n);$('metrics').append(box);}
    if(!append)$('companies').replaceChildren();
    for(const company of result.data){const row=document.createElement('tr'); const name=cell(row,company.name);const sub=document.createElement('small');sub.textContent=company.slug+' · '+labels[company.status];name.append(sub);
      const plan=cell(row,company.plan.name);const price=document.createElement('small');price.textContent=money(company.plan.priceCents)+' / mês no catálogo';plan.append(price);
      cell(row,`${company._count.channels}/${company.plan.maxChannels} canais · ${company._count.users}/${company.plan.maxUsers} usuários`);
      cell(row,company.subscription?.cancellationPending?'Cancelamento pendente':labels[company.subscription?.status]||'Sem assinatura');const actions=cell(row,'');
      if(company.subscription){const note=document.createElement('small');const sub=company.subscription;note.textContent=sub.calendarError||sub.billingCycles?.length?'Cobrança requer revisão':sub.calendarEnabled?`Calendário a partir de ${sub.billingStartMonth} · contratado ${money(sub.billingPriceCents)}`:'Calendário anterior';actions.append(note);}
      const edit=document.createElement('button');edit.textContent='Trocar plano';edit.disabled=company.subscription?.status==='CANCELED';edit.onclick=()=>openAction(company,'plan');actions.append(edit);
      if(company.subscription&&(company.subscription.status!=='CANCELED'||company.subscription.cancellationPending)){const cancel=document.createElement('button');cancel.textContent=company.subscription.cancellationPending?'Repetir cancelamento':'Encerrar contrato';cancel.onclick=()=>openAction(company,'cancel');actions.append(cancel);}
      if(company.subscription && (company.subscription.status!=='ACTIVE'||company.status!=='ACTIVE')){const activate=document.createElement('button');activate.textContent='Ativar contrato';activate.disabled=!!company.subscription.cancellationPending;activate.title=activate.disabled?'Conclua o cancelamento pendente primeiro':'';activate.onclick=()=>openAction(company,'activate');actions.append(activate);}
      if(!company.subscription){const create=document.createElement('button');create.textContent='Criar contrato';create.onclick=()=>openContract(company,create);actions.append(create);}
      if(company.subscription){const delivery=document.createElement('button');delivery.textContent='Avisos de cobrança';delivery.onclick=()=>openDelivery(company);actions.append(delivery);}
      $('companies').append(row);
    }
    cursor=result.nextCursor;$('more').hidden=!cursor;$('empty').hidden=!!$('companies').children.length;$('notice').textContent='';
  }catch(error){$('notice').textContent=error.message;}finally{busy=false;$('more').disabled=false;}
}
$('filters').onsubmit=event=>{event.preventDefault();load(false);};$('more').onclick=()=>load(true);
function openAction(company,type){$('contractFields').hidden=true;$('contractFields').disabled=true;$('billingDocument').value='';$('billingEmail').value='';selection={company,type};$('companyName').textContent=company.name;$('actionLabel').textContent=type==='plan'?'ALTERAR PLANO DE ACESSO':'ENCERRAR CONTRATO';$('planLabel').hidden=type!=='plan';$('plan').replaceChildren();for(const p of plans){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name} · ${p.maxChannels} canais · ${p.maxUsers} usuários · catálogo ${money(p.priceCents)}`;option.selected=p.id===company.plan.id;$('plan').append(option);}
  $('impact').textContent=type==='plan'?'Os limites de acesso serão atualizados imediatamente. O valor da recorrência e as cobranças existentes no Asaas NÃO serão alterados. Se ainda não houver assinatura, uma nova assinatura usará o preço do plano vigente.':'O acesso operacional será suspenso e os envios agendados serão cancelados. A recorrência será interrompida no Asaas; cobranças existentes e histórico serão preservados. Não há estorno automático.';
  $('ackText').textContent=type==='plan'?'Entendo que esta alteração não reajusta a assinatura existente.':'Confirmo o encerramento imediato desta empresa.';if(type==='activate'){
    $('actionLabel').textContent='ATIVAR CONTRATO';
    $('impact').textContent='O acesso será liberado e a cobrança mensal retomada no calendário dia 1 / dia 10, preservando mensalidades existentes. Não haverá cobrança imediata. Mensalidades vencidas ou emissões incertas precisam ser regularizadas antes. Campanhas canceladas não serão retomadas.';
    $('ackText').textContent='Confirmo a ativação do acesso e a retomada das próximas mensalidades.';
  }
  $('confirmPassword').value='';$('ack').checked=false;$('actionError').textContent='';$('confirm').disabled=false;$('action').showModal();
}
async function openContract(company,button){
  if(openingContract)return;openingContract=true;button.disabled=true;$('notice').textContent='Consultando condições do contrato…';
  try{
    const preview=await api(`/owner/tenants/${encodeURIComponent(company.id)}/contract-preview`);
    if(!token)return;
    openAction(company,'contract');selection.preview=preview;
    $('contractFields').hidden=false;$('contractFields').disabled=false;
    $('actionLabel').textContent='CRIAR E ATIVAR CONTRATO';
    const date=value=>value.split('-').reverse().join('/');
    $('impact').textContent=`Plano ${preview.planName}: ${money(preview.priceCents)} por mês. Primeira emissão em ${date(preview.firstIssueDate)}, vencimento em ${date(preview.firstDueDate)}. O acesso será liberado ao confirmar, antes do primeiro pagamento. Sem cobrança proporcional do período anterior. A mensalidade será emitida pelo calendário; esta ação não recebe pagamento.`;
    $('ackText').textContent='Confirmo os dados financeiros, o valor mensal, as datas e a liberação do acesso antes do pagamento.';
    $('notice').textContent='';
  }catch(error){$('notice').textContent=error.message;}finally{openingContract=false;button.disabled=false;}
}
$('close').onclick=()=>{$('action').close();$('confirmPassword').value='';$('billingDocument').value='';$('billingEmail').value='';};
$('actionForm').onsubmit=async event=>{event.preventDefault();if(!selection)return;const {company,type}=selection;$('confirm').disabled=true;$('close').disabled=true;const currentPassword=$('confirmPassword').value;
  try{
    let payload=type==='plan'?{planId:$('plan').value,expectedPlanId:company.plan.id,currentPassword,confirmation:'ACCESS_ONLY'}:{currentPassword,confirmation:type==='activate'?'ACTIVATE':'CANCEL'};
    if(type==='contract'){
      const cpfCnpj=$('billingDocument').value.replace(/[.\/\-\s]/g,'');
      if(!/^(?:\d{11}|\d{14})$/.test(cpfCnpj))throw new Error('Informe um CPF de 11 dígitos ou CNPJ de 14 dígitos.');
      const preview=selection.preview;
      payload={currentPassword,confirmation:'CREATE_CONTRACT',cpfCnpj,email:$('billingEmail').value.trim(),expectedPlanId:preview.planId,expectedPriceCents:preview.priceCents,expectedStartMonth:preview.startMonth};
    }
    const result=await api(`/owner/tenants/${encodeURIComponent(company.id)}/${type}`,{method:type==='plan'?'PATCH':'POST',body:JSON.stringify(payload)});
    $('action').close();$('billingDocument').value='';$('billingEmail').value='';await load(false);
    $('notice').textContent=type==='contract'?`Contrato criado e acesso liberado. Primeira emissão: ${result.firstIssueDate.split('-').reverse().join('/')}; vencimento: ${result.firstDueDate.split('-').reverse().join('/')}.`:type==='plan'?'Plano de acesso atualizado. Cobrança existente mantida.':type==='activate'?'Contrato ativado. Calendário mensal retomado.':'Contrato encerrado.';
  }
  catch(error){$('actionError').textContent=error.message;}finally{$('confirmPassword').value='';$('confirm').disabled=false;$('close').disabled=false;}
};

function clearCompanyResult(){
  createdCompany=null;$('createdCompanyPassword').value='';$('createdCompanyPassword').type='password';
  $('createdCompanyName').textContent='';$('createdCompanyEmail').textContent='';$('companyInvitationStatus').textContent='';
  $('revealCompanyPassword').textContent='Mostrar senha';$('copyCompanyPassword').textContent='Copiar senha';$('companyResult').close();
}
$('newCompany').onclick=()=>{
  if(creatingCompany)return;
  $('companyForm').reset();$('companyError').textContent='';$('newCompanyPlan').replaceChildren();
  for(const p of plans){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name} · ${money(p.priceCents)}/mês · ${p.maxChannels} canais · ${p.maxUsers} usuários`;option.disabled=p.maxUsers<1;$('newCompanyPlan').append(option);}
  $('companyDialog').showModal();$('newCompanyName').focus();
};
$('closeCompany').onclick=()=>{if(!creatingCompany){$('companyDialog').close();$('companyForm').reset();}};
$('companyDialog').addEventListener('cancel',event=>{if(creatingCompany)event.preventDefault();else $('companyForm').reset();});
$('companyResult').addEventListener('cancel',event=>{event.preventDefault();clearCompanyResult();});
$('closeCompanyResult').onclick=clearCompanyResult;
$('revealCompanyPassword').onclick=()=>{const show=$('createdCompanyPassword').type==='password';$('createdCompanyPassword').type=show?'text':'password';$('revealCompanyPassword').textContent=show?'Ocultar senha':'Mostrar senha';};
$('copyCompanyPassword').onclick=async()=>{try{await navigator.clipboard.writeText($('createdCompanyPassword').value);$('copyCompanyPassword').textContent='Copiada';}catch{$('copyCompanyPassword').textContent='Selecione e copie o campo';$('createdCompanyPassword').focus();$('createdCompanyPassword').select();}};
$('createCompanyContract').onclick=()=>{const company=createdCompany;clearCompanyResult();if(company)openContract(company,$('newCompany'));};
$('companyForm').onsubmit=async event=>{
  event.preventDefault();if(creatingCompany)return;creatingCompany=true;$('saveCompany').disabled=true;$('closeCompany').disabled=true;$('companyError').textContent='';
  try{
    const temporaryPassword=$('newAdminPassword').value;
    if(temporaryPassword && new TextEncoder().encode(temporaryPassword).length>72)throw new Error('A senha temporária deve ter no máximo 72 bytes.');
    const data=await api('/owner/tenants',{method:'POST',body:JSON.stringify({companyName:$('newCompanyName').value.trim(),adminName:$('newAdminName').value.trim(),adminEmail:$('newAdminEmail').value.trim().toLowerCase(),planId:$('newCompanyPlan').value,...(temporaryPassword?{temporaryPassword}:{}),sendInvitation:$('sendCompanyInvitation').checked,currentPassword:$('companyOwnerPassword').value,confirmation:'CREATE_COMPANY'})});
    $('companyDialog').close();$('companyForm').reset();
    createdCompany=data.tenant;$('createdCompanyName').textContent=data.tenant.name;$('createdCompanyEmail').textContent='Administrador: '+data.user.email;$('createdCompanyPassword').value=data.temporaryPassword;
    const messages={accepted:'O provedor de e-mail aceitou o convite. Peça ao administrador para conferir a caixa de entrada e o spam.',failed:'Empresa criada, mas o envio do convite falhou. Repasse a senha temporária por um canal privado ou use a recuperação de senha.',not_configured:'Empresa criada. O envio de e-mail não está configurado; repasse o acesso por um canal privado.',not_requested:'Convite por e-mail não solicitado. Repasse o acesso por um canal privado.'};
    $('companyInvitationStatus').textContent=messages[data.invitationEmailStatus]||'Confira o envio do convite.';
    $('companyResult').showModal();$('search').value=data.tenant.slug;$('status').value='';await load(false);
  }catch(error){$('companyError').textContent=error.message;}finally{creatingCompany=false;$('saveCompany').disabled=false;$('closeCompany').disabled=false;$('companyOwnerPassword').value='';$('newAdminPassword').value='';}
};

let deliverySelection=null, deliveryBusy=false, sandboxTest=null;
const deliveryLabels={QUEUED:'Na fila',RETRY:'Aguardando nova tentativa',SENDING:'Enviando',SENT:'Aceito pelo provedor / confirmado',REVIEW:'Revisão necessária',SKIPPED:'Não enviado'};
const deliveryErrors={SANDBOX_TARGET_CHANGED:'Destino do teste alterado; envio bloqueado',SANDBOX_EVOLUTION_ONLY:'Teste disponível somente via Evolution',SANDBOX_DISABLED:'Teste desativado ou ambiente fora do Sandbox',SANDBOX_EMAIL_ONLY:'Teste exclusivo por e-mail',DISABLED:'Envio desativado ou contrato encerrado',BEFORE_ACTIVATION:'Cobrança anterior à ativação',PAYMENT_NOT_OPEN:'Cobrança paga, removida ou não disponível para pagamento',PAYMENT_MISMATCH:'Dados da cobrança divergentes',LINK_UNAVAILABLE:'Link da cobrança indisponível',EMAIL_CONFIG_REQUIRED:'Configure o e-mail no servidor e no contrato',WHATSAPP_CONFIG_REQUIRED:'Confira o canal conectado e o celular',META_TEMPLATE_REQUIRED:'Configure um modelo aprovado da Meta',DELIVERY_UNCERTAIN:'O provedor pode ter recebido. Confira antes de repetir',PREFLIGHT_UNAVAILABLE:'Não foi possível conferir os dados antes do envio'};
async function openDelivery(company){
  if(deliveryBusy)return;deliveryBusy=true;$('notice').textContent='Carregando avisos…';
  try {
    const data=await api(`/owner/tenants/${encodeURIComponent(company.id)}/delivery`);if(!token)return;
    deliverySelection=company;$('deliveryForm').reset();$('deliveryCompany').textContent=company.name;
    $('deliveryReadiness').textContent=`Processamento ${data.workerEnabled?'ativado':'desativado no servidor'} · E-mail ${data.emailReady?'configurado':'pendente'} · Modelo Meta ${data.metaTemplateReady?'configurado':'pendente (apenas API oficial)'}`;
    const prefs=data.settings||{};
    sandboxTest={...data.sandboxTest,email:prefs.email,phone:prefs.phone,channelId:prefs.channelId};
    const testChannel=data.channels.find(channel=>channel.id===prefs.channelId);
    sandboxTest.requiresReconciliation=(data.history||[]).some(row=>row.kind==='WHATSAPP'&&row.cycle?.id===sandboxTest.cycleId&&row.state==='SKIPPED'&&row.error==='SANDBOX_TARGET_CHANGED'&&!!row.attemptedAt);
    $('sandboxWhatsapp').disabled=!(sandboxTest.available&&sandboxTest.cycleId&&data.workerEnabled&&data.enabled&&prefs.whatsappEnabled&&prefs.phone&&testChannel?.type==='QR_EVOLUTION'&&testChannel?.status==='CONNECTED');
    $('sandboxWhatsappInfo').textContent=sandboxTest.cycleId?`WhatsApp: reutiliza a última cobrança de teste, sem gerar outra nem reenviar e-mail. Destino salvo: ${prefs.phone||'não configurado'} · canal: ${testChannel?.name||'não configurado'}. Use um número sob seu controle e um canal Evolution conectado.`:'Gere primeiro o teste por e-mail para habilitar o envio da mesma cobrança por WhatsApp.';
    $('sandboxBillingSection').hidden=!sandboxTest.available;
    $('sandboxBilling').disabled=!(data.workerEnabled&&data.emailReady&&data.enabled&&prefs.emailEnabled&&prefs.email);
    $('sandboxBillingInfo').textContent=`Teste de ${money(sandboxTest.valueCents||500)} · e-mail salvo: ${prefs.email||'não configurado'} · um teste por empresa/dia. Salve a configuração antes de testar.`;
    $('sandboxBillingResult').textContent='';$('deliveryEmailEnabled').checked=!!prefs.emailEnabled;$('deliveryWhatsappEnabled').checked=!!prefs.whatsappEnabled;
    $('deliveryEmail').value=prefs.email||'';$('deliveryPhone').value=prefs.phone?(prefs.phone.startsWith('55')?prefs.phone:'+'+prefs.phone):'';$('deliveryBillingType').value=data.billingType;
    $('deliveryChannel').replaceChildren(new Option('Selecione o canal remetente',''));
    for(const channel of data.channels){const option=new Option(`${channel.name} · ${channel.type==='OFFICIAL_META'?'Meta':'Evolution'} · ${channel.status}`,channel.id);option.selected=channel.id===prefs.channelId;$('deliveryChannel').append(option);}
    $('deliveryHistory').replaceChildren();
    for(const row of data.history){const entry=document.createElement('div');entry.className='card';const text=document.createElement('p');text.textContent=`${row.cycle.isTest?'TESTE · ':''}${row.cycle.month} · ${row.kind==='EMAIL'?'E-mail':'WhatsApp'} · ${deliveryLabels[row.state]||row.state}`;entry.append(text);if(row.error){const note=document.createElement('p');note.textContent=deliveryErrors[row.error]||'Confira o envio';entry.append(note);}
      if(row.state==='REVIEW')for(const [action,label] of [['MARK_SENT','Confirmar que já foi enviado'],['RETRY_CONFIRMED_NOT_SENT','Conferi: não foi enviado. Tentar novamente']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>reviewDelivery(row.id,action);entry.append(button);}
      $('deliveryHistory').append(entry);
    }
    if(!data.history.length)$('deliveryHistory').textContent='Nenhum envio registrado. A configuração vale para novas mensalidades.';
    $('deliveryError').textContent='';if(!$('deliveryDialog').open)$('deliveryDialog').showModal();$('notice').textContent='';
  }catch(error){$('notice').textContent=error.message;}finally{deliveryBusy=false;}
}
$('closeDelivery').onclick=()=>{if(!deliveryBusy){$('deliveryDialog').close();$('deliveryForm').reset();deliverySelection=null;}};
$('deliveryDialog').addEventListener('cancel',event=>{if(deliveryBusy)event.preventDefault();else{$('deliveryForm').reset();deliverySelection=null;}});
$('deliveryForm').onsubmit=async event=>{
  event.preventDefault();if(!deliverySelection||deliveryBusy)return;deliveryBusy=true;$('saveDelivery').disabled=true;
  try{
    const phone=$('deliveryPhone').value.trim();
    if($('deliveryWhatsappEnabled').checked && (!phone || !/^\+?[\d\s().-]+$/.test(phone)))throw new Error('Informe DDD e telefone. Para outros países, use + e o código do país.');
    const email=$('deliveryEmail').value.trim(),channelId=$('deliveryChannel').value;
    await api(`/owner/tenants/${encodeURIComponent(deliverySelection.id)}/delivery`,{method:'PATCH',body:JSON.stringify({emailEnabled:$('deliveryEmailEnabled').checked,whatsappEnabled:$('deliveryWhatsappEnabled').checked,...(email?{email}:{}),...(phone?{phone}:{}),...(channelId?{channelId}:{}),billingType:$('deliveryBillingType').value,takeoverConfirmed:$('deliveryAck').checked,currentPassword:$('deliveryPassword').value})});
    const company=deliverySelection;deliveryBusy=false;await openDelivery(company);
    $('deliveryError').textContent='Configuração salva. Será aplicada nas próximas emissões.';
  }catch(error){$('deliveryError').textContent=error.message;}finally{deliveryBusy=false;$('saveDelivery').disabled=false;$('deliveryPassword').value='';}
};
async function reviewDelivery(id,action){
  if(deliveryBusy||!deliverySelection)return;
  if(!$('deliveryPassword').value){$('deliveryError').textContent='Preencha sua senha de proprietário antes de revisar.';$('deliveryPassword').focus();return;}
  if(!confirm(action==='MARK_SENT'?'Você verificou que este aviso foi enviado?':'Confirma que verificou no provedor e este aviso NÃO foi enviado? Uma nova tentativa pode duplicar mensagens se o envio anterior tiver ocorrido.'))return;
  const company=deliverySelection;deliveryBusy=true;
  try{await api(`/owner/deliveries/${encodeURIComponent(id)}/review`,{method:'POST',body:JSON.stringify({action,currentPassword:$('deliveryPassword').value})});deliveryBusy=false;await openDelivery(company);}
  catch(error){$('deliveryError').textContent=error.message;}finally{deliveryBusy=false;$('deliveryPassword').value='';}
}

$('refreshDelivery').onclick=()=>{if(deliverySelection&&!deliveryBusy)openDelivery(deliverySelection);};
$('sandboxBilling').onclick=async()=>{
  if(deliveryBusy||!deliverySelection||!sandboxTest?.available)return;
  const password=$('deliveryPassword').value;
  if(!password){$('sandboxBillingResult').textContent='Preencha sua senha de proprietário no campo acima.';$('deliveryPassword').focus();return;}
  if(!confirm(`Gerar ou consultar a cobrança de teste de R$ 5,00 no Sandbox e enviar para ${sandboxTest.email}? Repetições do mesmo teste não geram outra cobrança nem reenviam um e-mail já aceito.`))return;
  const company=deliverySelection, snapshot={...sandboxTest};
  deliveryBusy=true;$('sandboxBilling').disabled=true;$('saveDelivery').disabled=true;
  try{
    const result=await api(`/owner/tenants/${encodeURIComponent(company.id)}/sandbox-billing`,{method:'POST',body:JSON.stringify({currentPassword:password,confirmation:'SANDBOX_EMAIL',date:snapshot.date,expectedEmail:snapshot.email})});
    deliveryBusy=false;await openDelivery(company);
    if(!token||deliverySelection?.id!==company.id)return;
    $('sandboxBillingResult').textContent=`Cobrança de teste registrada. E-mail: ${deliveryLabels[result.emailState]||result.emailState}. Confira sua caixa de entrada e o spam. ${result.error?(deliveryErrors[result.error]||'Confira o histórico.') : ''}`;
  }catch(error){$('sandboxBillingResult').textContent=error.message;}
  finally{deliveryBusy=false;$('sandboxBilling').disabled=false;$('saveDelivery').disabled=false;$('deliveryPassword').value='';}
};

$('sandboxWhatsapp').onclick=async()=>{
  if(deliveryBusy||!deliverySelection||!sandboxTest?.available||!sandboxTest.cycleId)return;
  const password=$('deliveryPassword').value;
  if(!password){$('sandboxBillingResult').textContent='Preencha sua senha de proprietário no campo acima.';$('deliveryPassword').focus();return;}
  const company=deliverySelection,snapshot={...sandboxTest};
  let confirmedNotSent=false;
  if(snapshot.requiresReconciliation){
    if(!confirm(`Este teste tem uma tentativa anterior. Você conferiu no WhatsApp remetente/provedor que a cobrança NÃO foi enviada? Confirmar autoriza nova tentativa para ${snapshot.phone}. Se houver dúvida, cancele para evitar duplicidade.`))return;
    confirmedNotSent=true;
  }
  if(!confirm(`Enviar a cobrança Sandbox existente para ${snapshot.phone} pelo canal salvo? Confirme que esse número está sob seu controle. Não será gerada outra cobrança nem reenviado o e-mail. Um envio já aceito não será repetido.`))return;
  deliveryBusy=true;$('sandboxWhatsapp').disabled=true;$('sandboxBilling').disabled=true;$('saveDelivery').disabled=true;
  try{
    const result=await api(`/owner/tenants/${encodeURIComponent(company.id)}/sandbox-whatsapp`,{method:'POST',body:JSON.stringify({currentPassword:password,confirmation:'SANDBOX_WHATSAPP',cycleId:snapshot.cycleId,expectedPhone:snapshot.phone,expectedChannelId:snapshot.channelId,...(confirmedNotSent?{confirmedNotSent:true}:{})})});
    deliveryBusy=false;await openDelivery(company);
    if(!token||deliverySelection?.id!==company.id)return;
    $('sandboxBillingResult').textContent=`Teste WhatsApp: ${deliveryLabels[result.whatsappState]||result.whatsappState}. Confira o celular de destino. ${result.error?(deliveryErrors[result.error]||'Confira o histórico antes de repetir.') : ''}`;
  }catch(error){$('sandboxBillingResult').textContent=error.message;}
  finally{deliveryBusy=false;$('saveDelivery').disabled=false;$('deliveryPassword').value='';}
};
