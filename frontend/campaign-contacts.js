export function mergeCampaignRecipients(selected, manual) {
  const merged = new Map(selected.map(c => [c.phone, { ...c }]));
  const seen = new Set();
  for (const c of manual) {
    if (seen.has(c.phone)) throw new Error('Telefone repetido na inclusão manual. Use uma linha por contato.');
    seen.add(c.phone); merged.set(c.phone, { ...merged.get(c.phone), ...c });
  }
  if (merged.size > 100) throw new Error('Selecione no máximo 100 destinatários, somando contatos e inclusão manual.');
  return [...merged.values()];
}

export function createCampaignContacts({ root, api, channels, settings, escape, notice }) {
  const selected = new Map(); let rows = [], cursor = null, request = 0;
  const $ = selector => root.querySelector(selector);
  root.innerHTML = `<legend>Contatos das conversas</legend><p class="muted">Busque contatos da empresa que já trocaram mensagens. Pedidos de saída não aparecem na lista. Selecionar não envia mensagens.</p><label>Nome ou telefone<input data-contact-search maxlength="80" placeholder="Ex.: Maria ou 31 99999"></label><div class="two-fields"><label>Canal do histórico<select data-contact-channel><option value="">Todos os canais</option>${channels.map(c=>`<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('')}</select></label><label>Setor<select data-contact-department><option value="">Todos os setores</option>${(settings.departments||[]).map(d=>`<option value="${escape(d.id)}">${escape(d.name)}</option>`).join('')}</select></label></div><label>Etapa do funil<select data-contact-stage><option value="">Todas as etapas</option>${(settings.stages||[]).map(s=>`<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('')}</select></label><div class="actions"><button type="button" class="outline" data-contact-find>Buscar contatos</button><button type="button" class="outline" data-contact-all>Selecionar exibidos</button><button type="button" class="text-button" data-contact-clear>Limpar seleção</button></div><p data-contact-status class="muted" role="status"></p><div data-contact-results class="campaign-contact-list"></div><button type="button" class="outline" data-contact-more hidden>Carregar mais contatos</button><details class="campaign-selected"><summary data-contact-count>0 contatos selecionados</summary><p class="muted">Você pode ajustar o nome para esta campanha. Isso não altera o cadastro do contato.</p><div data-contact-selected class="campaign-contact-list"></div></details>`;
  function renderSelection() {
    $('[data-contact-count]').textContent = `${selected.size} de 100 contatos selecionados`;
    $('[data-contact-selected]').innerHTML = [...selected.values()].map(c=>`<div class="campaign-contact-row"><label>${escape(c.phone)}<input data-selected-name="${escape(c.phone)}" value="${escape(c.name || '')}" maxlength="120" placeholder="Nome para personalizar a mensagem"></label><button type="button" class="text-button danger" data-contact-remove="${escape(c.phone)}">Remover</button></div>`).join('');
    root.querySelectorAll('[data-selected-name]').forEach(input=>input.oninput=()=>{const c=selected.get(input.dataset.selectedName);if(input.value.trim())c.name=input.value.trim();else delete c.name;});
    root.querySelectorAll('[data-contact-remove]').forEach(button=>button.onclick=()=>{selected.delete(button.dataset.contactRemove);renderSelection();});
    root.querySelectorAll('[data-select-contact]').forEach(input=>{input.checked=selected.has(input.dataset.selectContact);input.disabled=!input.checked&&selected.size>=100;});
  }
  function select(c) {
    if (selected.has(c.phone)) return;
    if (selected.size >= 100) return notice('Limite de 100 contatos selecionados.');
    selected.set(c.phone, {phone:c.phone,...(c.name ? {name:c.name} : {})});
  }
  function renderRows() {
    $('[data-contact-results]').innerHTML = rows.map(c=>`<label class="checkbox campaign-contact-option"><input type="checkbox" data-select-contact="${escape(c.phone)}"><span><strong>${escape(c.name || c.phone)}</strong><small>${escape(c.phone)}</small></span></label>`).join('');
    root.querySelectorAll('[data-select-contact]').forEach(input=>input.onchange=()=>{if(input.checked)select(rows.find(c=>c.phone===input.dataset.selectContact));else selected.delete(input.dataset.selectContact);renderSelection();});
    renderSelection();
  }
  async function load(more=false) {
    const generation=++request;
    if (!more) {rows=[];cursor=null;$('[data-contact-more]').hidden=true;renderRows();}
    const params=new URLSearchParams();
    for(const [key,selector] of [['search','search'],['channelId','channel'],['departmentId','department'],['stageId','stage']]){const value=$(`[data-contact-${selector}]`).value.trim();if(value)params.set(key,value);}
    if(more&&cursor)params.set('cursor',cursor);
    $('[data-contact-status]').textContent='Buscando contatos…';$('[data-contact-more]').disabled=true;
    try {
      const result=await api(`/campaigns/contacts?${params}`);
      if(generation!==request||!root.isConnected)return;
      const contacts=Array.isArray(result.contacts)?result.contacts:[];
      rows=[...new Map([...rows,...contacts].map(c=>[c.phone,c])).values()];cursor=result.nextCursor||null;
      renderRows();$('[data-contact-status]').textContent=rows.length ? `${rows.length} contato(s) exibido(s). A seleção é mantida ao mudar a busca.` : 'Nenhum contato elegível nesta página. Tente outra busca ou carregue a próxima página.';
      $('[data-contact-more]').hidden=!cursor;
    } catch(error) {if(generation===request&&root.isConnected)$('[data-contact-status]').textContent=error.message;}
    finally {if(generation===request&&root.isConnected)$('[data-contact-more]').disabled=false;}
  }
  $('[data-contact-find]').onclick=()=>load();
  $('[data-contact-search]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
  for(const key of ['channel','department','stage'])$(`[data-contact-${key}]`).onchange=()=>load();
  $('[data-contact-more]').onclick=()=>load(true);
  $('[data-contact-all]').onclick=()=>{for(const c of rows){if(selected.size>=100)break;select(c);}renderSelection();};
  $('[data-contact-clear]').onclick=()=>{selected.clear();renderSelection();};
  void load();
  return { recipients:()=>[...selected.values()].map(c=>({...c})) };
}
