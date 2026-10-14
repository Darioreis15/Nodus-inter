'use strict';
// Public backend URL only. Never place secrets or the owner's ID here.
const API = 'https://nodus-inter.onrender.com';
const $ = id => document.getElementById(id);
let token = '', plans = [], cursor = null, selection = null, busy = false;
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
function signOut() { token=''; selection=null; $('dashboard').hidden=true; $('loginPanel').hidden=false; $('logout').hidden=true; $('companies').replaceChildren(); $('action').close(); $('confirmPassword').value=''; }
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
      $('companies').append(row);
    }
    cursor=result.nextCursor;$('more').hidden=!cursor;$('empty').hidden=!!$('companies').children.length;$('notice').textContent='';
  }catch(error){$('notice').textContent=error.message;}finally{busy=false;$('more').disabled=false;}
}
$('filters').onsubmit=event=>{event.preventDefault();load(false);};$('more').onclick=()=>load(true);
function openAction(company,type){selection={company,type};$('companyName').textContent=company.name;$('actionLabel').textContent=type==='plan'?'ALTERAR PLANO DE ACESSO':'ENCERRAR CONTRATO';$('planLabel').hidden=type!=='plan';$('plan').replaceChildren();for(const p of plans){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name} · ${p.maxChannels} canais · ${p.maxUsers} usuários · catálogo ${money(p.priceCents)}`;option.selected=p.id===company.plan.id;$('plan').append(option);}
  $('impact').textContent=type==='plan'?'Os limites de acesso serão atualizados imediatamente. O valor da recorrência e as cobranças existentes no Asaas NÃO serão alterados. Se ainda não houver assinatura, uma nova assinatura usará o preço do plano vigente.':'O acesso operacional será suspenso e os envios agendados serão cancelados. A recorrência será interrompida no Asaas; cobranças existentes e histórico serão preservados. Não há estorno automático.';
  $('ackText').textContent=type==='plan'?'Entendo que esta alteração não reajusta a assinatura existente.':'Confirmo o encerramento imediato desta empresa.';$('confirmPassword').value='';$('ack').checked=false;$('actionError').textContent='';$('confirm').disabled=false;$('action').showModal();
}
$('close').onclick=()=>{$('action').close();$('confirmPassword').value='';};
$('actionForm').onsubmit=async event=>{event.preventDefault();if(!selection)return;const {company,type}=selection;$('confirm').disabled=true;$('close').disabled=true;const currentPassword=$('confirmPassword').value;
  try{await api(`/owner/tenants/${encodeURIComponent(company.id)}/${type}`,{method:type==='plan'?'PATCH':'POST',body:JSON.stringify(type==='plan'?{planId:$('plan').value,expectedPlanId:company.plan.id,currentPassword,confirmation:'ACCESS_ONLY'}:{currentPassword,confirmation:'CANCEL'})});$('action').close();await load(false);$('notice').textContent=type==='plan'?'Plano de acesso atualizado. Cobrança existente mantida.':'Contrato encerrado.';}
  catch(error){$('actionError').textContent=error.message;}finally{$('confirmPassword').value='';$('confirm').disabled=false;$('close').disabled=false;}
};
