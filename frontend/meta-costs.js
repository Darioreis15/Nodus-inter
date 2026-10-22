export async function renderMetaCosts({root, api, escape, current}) {
  const channels = (await api('/channels')).filter(c => c.type === 'OFFICIAL_META');
  if (!current()) return;
  if (!channels.length) {
    root.innerHTML = '<section class="card"><h2>Gastos da API oficial</h2><p>Nenhum canal oficial da Meta cadastrado. Os canais Nodus via QR Code não geram este relatório.</p><p>Cadastre o canal em Conexões para consultar os valores disponibilizados pela Meta.</p></section>';
    return;
  }
  const month = new Date().toISOString().slice(0,7);
  root.innerHTML = `<section class="card"><h2>Consultar gastos</h2><p class="muted">Valores aproximados informados pela Meta, na moeda da conta. Podem sofrer atualização e não substituem a fatura. Não incluem a mensalidade Nodus. O período considera dias em UTC e todos os envios deste número, inclusive fora da Nodus.</p><form id="meta-cost-filter"><label>Canal<select name="channelId">${channels.map(c => `<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('')}</select></label><label>Mês<input type="month" name="month" value="${month}" max="${month}" required></label><button class="primary" type="submit">Consultar gastos</button></form></section><div id="meta-cost-result" role="status" aria-live="polite"></div><section class="card"><details><summary>Configurar conta Meta</summary><p>Se a conta ainda não estiver vinculada, informe o WABA ID do canal selecionado acima. O token salvo em Conexões precisa ter acesso à conta e permissão de gerenciamento do WhatsApp.</p><form id="meta-account-form"><label>WABA ID<input name="wabaId" inputmode="numeric" pattern="[0-9]+" maxlength="32" required autocomplete="off"></label><button class="outline" type="submit">Validar e vincular conta</button><p data-account-status role="status"></p></form></details></section>`;
  const filter = root.querySelector('#meta-cost-filter'), result = root.querySelector('#meta-cost-result');
  let generation = 0;
  const currencyValue = (value,currency) => {
    if (value === null || value === undefined || !currency) return 'Indisponível';
    try { return Number(value).toLocaleString('pt-BR',{style:'currency',currency,maximumFractionDigits:4}); } catch { return `${Number(value).toFixed(4)} ${currency}`; }
  };
  const load = async () => {
    const request = ++generation, values = new FormData(filter);
    const channelId = values.get('channelId'), selectedMonth = values.get('month');
    const valid = () => current() && request === generation && filter.elements.channelId.value === channelId && filter.elements.month.value === selectedMonth;
    result.textContent = 'Consultando a Meta…';
    try {
      const data = await api(`/reports/meta-costs?${new URLSearchParams({channelId,month:selectedMonth})}`);
      if (!valid()) return;
      const category = {MARKETING:'Marketing',UTILITY:'Utilidade',AUTHENTICATION:'Autenticação',AUTHENTICATION_INTERNATIONAL:'Autenticação internacional',SERVICE:'Serviço'};
      result.innerHTML = `<section class="card"><h2>${escape(data.channelName)} · ${escape(data.month)}</h2><p>${escape(data.phone)} · Moeda: ${escape(data.currency || 'não informada')}</p><div class="metrics"><article><small>Gasto aproximado no período</small><strong>${escape(currencyValue(data.totalCost,data.currency))}</strong></article><article><small>Mensagens no relatório Meta</small><strong>${data.totalVolume === null ? 'Indisponível' : escape(data.totalVolume)}</strong></article></div><p class="muted">Consultado em ${escape(new Date(data.updatedAt).toLocaleString('pt-BR'))}. Consultas reutilizadas por até 5 minutos.</p>${data.availability === 'NO_DATA' ? '<p>A Meta não retornou dados para este número e período. Isso não confirma gasto zero.</p>' : !data.costAvailable ? '<p>A Meta não disponibilizou todos os custos ou a moeda. Consulte o faturamento da conta ou seu provedor. Um valor indisponível não significa custo zero.</p>' : ''}<div style="overflow-x:auto"><table><thead><tr><th>Dia (UTC)</th><th>Categoria</th><th>Tipo de cobrança</th><th>Mensagens</th><th>Custo aproximado</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td>${escape(r.date)}</td><td>${escape(category[r.category] || r.category)}</td><td>${escape(r.pricingType)}</td><td>${r.volume === null ? '—' : escape(r.volume)}</td><td>${escape(currencyValue(r.cost,data.currency))}</td></tr>`).join('')}</tbody></table></div></section>`;
    } catch (error) { if (valid()) result.textContent = error.message || 'Não foi possível consultar os gastos.'; }
  };
  filter.onsubmit = event => { event.preventDefault(); load(); };
  filter.onchange = () => { generation++; result.textContent = 'Clique em Consultar gastos para atualizar o filtro.'; };
  const account = root.querySelector('#meta-account-form');
  account.onsubmit = async event => {
    event.preventDefault();
    const button = account.querySelector('button'), status = account.querySelector('[data-account-status]');
    const channelId = filter.elements.channelId.value;
    button.disabled = true; status.textContent = 'Validando conta…';
    try {
      await api(`/reports/meta-costs/${encodeURIComponent(channelId)}/account`,{method:'PATCH',body:JSON.stringify({wabaId:account.elements.wabaId.value.trim()})});
      if (!current()) return;
      status.textContent = 'Conta vinculada ao canal selecionado no momento do envio.';
      if (filter.elements.channelId.value === channelId) await load();
    } catch (error) { if(current()) status.textContent = error.message || 'Não foi possível vincular a conta.'; }
    finally { button.disabled = false; }
  };
  await load();
}
