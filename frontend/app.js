const API_URL = (window.NODUS_API_URL || '').trim().replace(/\/$/, '');
// Session credentials stay in memory. Reloading the tab requires signing in again.
try { localStorage.removeItem('nodus_token'); } catch { /* Browser storage may be disabled. */ }
const session = { token: null, user: null, tenant: null, conversations: [], active: null, messages: [], filter: 'OPEN', page: null, generation: 0 };
const app = document.querySelector('#app');
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escape = (text = '') => String(text ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const encoded = encodeURIComponent;
const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—';
const money = value => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const labels = { OPEN:'Caixa de entrada', PENDING:'Aguardando', RESOLVED:'Resolvidos', CONNECTED:'Conectado', DISCONNECTED:'Desconectado', SENT:'Enviada ao provedor', DELIVERED:'Entregue', READ:'Lida', FAILED:'Falhou', RECEIVED:'Recebida', QUEUED:'Na fila' };
const notice = text => { $$('.toast').forEach(el => el.remove()); const node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role','status'); node.textContent = text; document.body.append(node); setTimeout(() => node.remove(), 6000); };
const body = data => JSON.stringify(data);
function logo() { return '<div class="brand"><img src="./logo-nodus-mark.svg" alt=""/><span>Nodus</span></div>'; }
async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...options, signal: AbortSignal.timeout(25000), headers: { 'Content-Type':'application/json', ...(session.token ? { Authorization:`Bearer ${session.token}` } : {}), ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) logout(false);
    const error = new Error(Array.isArray(payload.message) ? payload.message.join(' ') : payload.message || 'Não foi possível concluir a solicitação.');
    error.status = response.status; throw error;
  }
  return payload;
}
async function busy(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  try { return await fn(); } catch (error) { notice(error.message); } finally { button.disabled = false; }
}
function bindForm(id, fn) {
  const form = $(id);
  form.onsubmit = event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); busy($('[type=submit]', form), () => fn(data, form)); };
}
function modal(title, html) {
  $('#modal')?.remove();
  const focus = document.activeElement;
  const el = document.createElement('dialog'); el.id = 'modal'; el.className = 'modal';
  el.innerHTML = `<button class="modal-close" aria-label="Fechar">×</button><h2>${escape(title)}</h2>${html}`;
  document.body.append(el); $('.modal-close', el).onclick = () => el.close();
  el.addEventListener('close', () => { el.remove(); focus?.focus(); }); el.showModal(); return el;
}
function secretDialog(title, value, explanation) {
  const el = modal(title, `<p>${escape(explanation)}</p><label>Copie e guarde agora<input id="secret-value" readonly autocomplete="off"></label><button id="copy-secret" class="primary">Copiar</button>`);
  $('#secret-value').value = value;
  $('#copy-secret').onclick = async () => { try { await navigator.clipboard.writeText(value); notice('Copiado.'); } catch { $('#secret-value').select(); notice('Use Ctrl+C para copiar.'); } };
}
function renderLogin(error = '') {
  session.generation++; session.page = null;
  app.innerHTML = `<section class="login"><div class="login-art"><div class="weave"></div>${logo()}<div class="login-copy"><p class="eyebrow">CENTRAL DE ATENDIMENTO</p><h1>As conversas da sua empresa, conectadas em um só lugar.</h1><p>Acompanhe, responda e resolva cada contato com clareza.</p></div><div class="knot">∞</div></div><div class="login-form"><div class="form-box"><div class="mobile-brand">${logo()}</div><p class="eyebrow">BEM-VINDO DE VOLTA</p><h2>Acesse o sistema</h2><p class="muted">Entre com os dados da sua empresa.</p><form id="login-form"><label>E-mail<input type="email" name="email" autocomplete="username" required></label><label>Senha<input type="password" name="password" autocomplete="current-password" required></label><p class="form-error">${escape(error)}</p><button type="submit" class="primary">Entrar no painel →</button></form><button class="text-button" id="forgot">Esqueci minha senha</button><p class="help"><a href="https://nodusintegracao.com/#contato">Fale com a Nodus</a></p></div></div></section>`;
  bindForm('#login-form', async data => {
    const result = await api('/auth/login', { method:'POST', body:body({ ...data, email:data.email.trim().toLowerCase() }) });
    session.token = result.accessToken;
    if (result.mustChangePassword) return passwordChange();
    await startApp();
  });
  $('#forgot').onclick = forgotPassword;
}
function forgotPassword() {
  modal('Recuperar acesso', '<p>Informe o e-mail cadastrado. O link terá validade de 15 minutos.</p><form id="forgot-form"><label>E-mail<input name="email" type="email" required autocomplete="email"></label><button class="primary" type="submit">Enviar instruções</button></form>');
  bindForm('#forgot-form', async data => { const result = await api('/auth/forgot-password', { method:'POST', body:body({ email:data.email.trim().toLowerCase() }) }); $('#modal').close(); notice(result.message); });
}
function resetPassword(token) {
  renderLogin();
  history.replaceState(null, '', location.pathname + location.search);
  modal('Definir nova senha', '<form id="reset-form"><label>Nova senha (mínimo 12 caracteres)<input type="password" name="newPassword" minlength="12" required autocomplete="new-password"></label><label>Confirme a senha<input type="password" name="confirmation" required autocomplete="new-password"></label><button class="primary" type="submit">Salvar nova senha</button></form>');
  bindForm('#reset-form', async data => { if (data.newPassword !== data.confirmation) throw new Error('As senhas não coincidem.'); await api('/auth/reset-password', { method:'POST', body:body({ token, newPassword:data.newPassword }) }); $('#modal').close(); notice('Senha atualizada. Entre com a nova senha.'); });
}
function passwordChange() {
  renderLogin();
  const el = modal('Troque sua senha temporária', '<p>Defina sua senha pessoal para continuar.</p><form id="password-form"><label>Senha temporária / atual<input type="password" name="currentPassword" required autocomplete="current-password"></label><label>Nova senha<input type="password" name="newPassword" minlength="12" required autocomplete="new-password"></label><button class="primary" type="submit">Atualizar senha</button></form>');
  bindForm('#password-form', async data => { await api('/auth/change-password', { method:'POST', body:body(data) }); el.close(); logout(false); notice('Senha alterada. Entre novamente.'); });
}
function renderShell() {
  const admin = session.user.role === 'ADMIN';
  const restricted = session.tenant.status === 'SUSPENDED';
  app.innerHTML = `<div class="shell"><aside class="sidebar">${logo()}<nav>${!restricted ? `<button class="nav-item" data-filter="OPEN">⌂ <span>Caixa de entrada</span></button><button class="nav-item" data-filter="PENDING">◌ <span>Aguardando</span></button><button class="nav-item" data-filter="RESOLVED">✓ <span>Resolvidos</span></button><hr><button class="nav-item" data-page="logs">◫ <span>Logs de conversas</span></button><button class="nav-item" data-page="reports">▥ <span>Relatórios</span></button><button class="nav-item" data-page="funnel">⇢ <span>Funil</span></button>${admin ? '<button class="nav-item" data-page="users">♙ <span>Operadores</span></button><button class="nav-item" data-page="connections">◉ <span>Conexões</span></button><button class="nav-item" data-page="settings">⚙ <span>Configurações</span></button>' : ''}` : ''}${admin ? '<button class="nav-item" data-page="billing">＄ <span>Mensalidades</span></button>' : ''}</nav><div class="sidebar-bottom"><button id="logout" class="profile"><div class="avatar small">${escape(session.user.name[0])}</div><span><strong>${escape(session.user.name)}</strong><em>Sair da conta</em></span>↗</button></div></aside><section class="inbox"><header class="inbox-header"><div><p class="eyebrow">ATENDIMENTOS</p><h1 id="list-title">Caixa de entrada</h1></div><button class="icon-btn" id="refresh" aria-label="Atualizar conversas">↻</button></header><button class="outline new-conversation" id="new-conversation">+ Nova conversa</button><label class="search">⌕<input id="search" placeholder="Buscar conversa" aria-label="Buscar conversa"></label><div id="conversation-list" class="conversation-list"></div><button class="text-button" id="more-conversations" hidden>Carregar mais conversas</button></section><section id="chat" class="chat empty"></section></div>`;
  $$('.nav-item').forEach(btn => btn.onclick = () => btn.dataset.page ? openPage(btn.dataset.page) : loadConversations(btn.dataset.filter));
  $('#refresh').onclick = () => loadConversations(session.filter);
  $('#new-conversation').onclick = newConversation;
  $('#search').oninput = e => drawList(e.target.value);
  $('#logout').onclick = () => logout(true);
  $('#more-conversations').onclick = e => busy(e.currentTarget, () => loadConversations(session.filter, true));
}
function emptyChat() { $('#chat').className = 'chat empty'; $('#chat').innerHTML = '<div><div class="empty-mark">∞</div><h2>Selecione uma conversa</h2><p>Escolha um atendimento ou inicie uma nova conversa.</p></div>'; }
function drawList(query = $('#search')?.value || '') {
  const list = $('#conversation-list'); if (!list) return;
  const matches = session.conversations.filter(c => `${c.contact.name || ''} ${c.contact.waId} ${c.lastMessage?.body || ''}`.toLowerCase().includes(query.toLowerCase()));
  list.innerHTML = matches.length ? matches.map(c => `<button class="conversation ${session.active?.id === c.id ? 'active' : ''}" data-id="${escape(c.id)}"><div class="avatar">${escape((c.contact.name || c.contact.waId)[0])}</div><div class="conversation-info"><div><strong>${escape(c.contact.name || c.contact.waId)}</strong><time>${escape(c.lastMessage ? new Date(c.lastMessage.createdAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '')}</time></div><p>${escape(c.lastMessage?.body || 'Sem mensagens')}</p><small>${escape(c.channel.name)}</small></div></button>`).join('') : '<p class="no-results">Nenhum atendimento encontrado.</p>';
  $$('.conversation', list).forEach(btn => btn.onclick = () => openConversation(btn.dataset.id));
}
async function loadConversations(status = 'OPEN', more = false) {
  const generation = more ? session.generation : ++session.generation;
  session.page = null; session.filter = status;
  $('.inbox').style.display = ''; $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.filter === status));
  $('#list-title').textContent = labels[status];
  if (!more) { session.active = null; emptyChat(); $('#conversation-list').innerHTML = '<p class="loading">Carregando…</p>'; }
  try {
    const rows = await api(`/conversations?status=${status}${more ? `&cursor=${encoded(session.conversations.at(-1).id)}` : ''}`);
    if (generation !== session.generation) return;
    session.conversations = more ? [...session.conversations, ...rows.filter(r => !session.conversations.some(c => c.id === r.id))] : rows;
    $('#more-conversations').hidden = rows.length < 100;
    drawList();
  } catch (err) { notice(err.message); }
}
async function openConversation(id) {
  const c = session.conversations.find(c => c.id === id); if (!c) return;
  session.page = null; session.active = c; const generation = ++session.generation;
  drawList(); const chat = $('#chat'); chat.className = 'chat mobile-open';
  chat.innerHTML = `<header class="chat-header"><button class="icon-btn mobile-back" aria-label="Voltar às conversas">←</button><div class="avatar">${escape((c.contact.name || c.contact.waId)[0])}</div><div><h2>${escape(c.contact.name || c.contact.waId)}</h2><p>${escape(c.contact.waId)} · ${escape(c.channel.name)}</p></div><div class="chat-actions"><button class="outline" id="rename-contact">Nome</button><button class="outline" id="assign">Assumir</button><button class="resolve" id="resolve">Resolver ✓</button>${c.channel.type === 'QR_EVOLUTION' ? '<button class="danger outline" id="delete-conversation">Excluir</button>' : '<button class="outline" id="send-template">Template</button>'}</div></header><button class="text-button" id="older-messages" hidden>Carregar mensagens anteriores</button><div id="messages" class="messages"><p class="loading">Carregando…</p></div><form id="message-form" class="composer"><textarea name="text" rows="2" maxlength="4000" placeholder="Escreva uma mensagem" aria-label="Mensagem" required></textarea><button class="send" type="submit" aria-label="Enviar mensagem">➜</button></form>`;
  $('.mobile-back').onclick = () => { chat.classList.remove('mobile-open'); };
  $('#assign').onclick = e => busy(e.currentTarget, async () => { await api(`/conversations/${encoded(id)}/assign`, { method:'PATCH', body:'{}' }); notice('Atendimento atribuído a você.'); });
  $('#resolve').onclick = e => busy(e.currentTarget, async () => { await api(`/conversations/${encoded(id)}/status`, { method:'PATCH', body:body({ status:'RESOLVED' }) }); await loadConversations(session.filter); notice('Atendimento finalizado.'); });
  $('#rename-contact').onclick = () => { modal('Nome do contato', `<form id="name-form"><label>Nome<input name="name" maxlength="120" value="${escape(c.contact.name || '')}" required></label><button type="submit" class="primary">Salvar</button></form>`); bindForm('#name-form', async data => { await api(`/conversations/${encoded(id)}/contact`, { method:'PATCH', body:body(data) }); c.contact.name = data.name; $('#modal').close(); openConversation(id); }); };
  if ($('#delete-conversation')) $('#delete-conversation').onclick = e => busy(e.currentTarget, async () => { if (!confirm('Excluir esta conversa e suas mensagens da plataforma? As cópias no celular e em outros sistemas permanecem.')) return; await api(`/conversations/${encoded(id)}`, { method:'DELETE' }); await loadConversations(session.filter); notice('Conversa excluída.'); });
  if ($('#send-template')) $('#send-template').onclick = () => sendTemplate(c);
  bindForm('#message-form', async (data, form) => {
    const text = data.text.trim(); if (!text) return;
    const sent = await api(`/conversations/${encoded(id)}/messages`, { method:'POST', body:body({ text }) });
    if (session.active?.id !== id) return;
    session.messages = [...session.messages, sent]; drawMessages(); form.reset(); c.lastMessage = sent; drawList();
  });
  $('#older-messages').onclick = e => busy(e.currentTarget, async () => {
    const oldest = [...session.messages].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id.localeCompare(b.id))[0];
    const rows = await api(`/conversations/${encoded(id)}/messages?cursor=${encoded(oldest.id)}`);
    if (session.active?.id !== id) return;
    session.messages = [...session.messages, ...rows.filter(m => !session.messages.some(x => x.id === m.id))];
    $('#older-messages').hidden = rows.length < 100; drawMessages(false);
  });
  try { const rows = await api(`/conversations/${encoded(id)}/messages`); if (generation !== session.generation) return; session.messages = rows; $('#older-messages').hidden = rows.length < 100; drawMessages(); } catch (err) { if ($('#messages')) $('#messages').textContent = err.message; }
}
function drawMessages(bottom = true) {
  const el = $('#messages'); if (!el) return;
  el.innerHTML = session.messages.length ? [...session.messages].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id.localeCompare(b.id)).map(m => `<div class="message ${m.direction === 'OUTBOUND' ? 'outbound' : 'inbound'}"><p>${escape(m.body)}</p><time>${escape(date(m.createdAt))} · ${escape(labels[m.status] || m.status)}</time></div>`).join('') : '<p class="no-results">Escreva a primeira mensagem para iniciar o atendimento.</p>';
  if (bottom) el.scrollTop = el.scrollHeight;
}
async function newConversation() {
  try {
    const channels = await api('/channels');
    modal('Nova conversa', `<form id="new-chat"><label>Canal<select name="channelId" required>${channels.map(c => `<option value="${escape(c.id)}">${escape(c.name)} · ${escape(c.phoneNumber || labels[c.status] || c.status)}</option>`).join('')}</select></label><label>Telefone com país e DDD<input name="phone" type="tel" placeholder="55 31 99999-9999" required></label><label>Nome (opcional)<input name="name" maxlength="120"></label><p class="muted">Na Meta, use um template aprovado para iniciar o contato fora da janela de atendimento.</p><button type="submit" class="primary" ${channels.length ? '' : 'disabled'}>Abrir conversa</button></form>`);
    bindForm('#new-chat', async data => { const c = await api('/conversations', { method:'POST', body:body(data) }); $('#modal').close(); await loadConversations(c.status); if (!session.conversations.some(x => x.id === c.id)) { const channel = channels.find(x => x.id === data.channelId); session.conversations.unshift({ ...c, contact:{ name:data.name, waId:data.phone }, channel }); } await openConversation(c.id); });
  } catch (err) { notice(err.message); }
}
function sendTemplate(c) {
  modal('Template aprovado pela Meta', '<p>Use o nome exato e o idioma de um template aprovado. Esta tela aceita parâmetros de texto no corpo.</p><form id="template-form"><label>Nome do template<input name="name" required pattern="[a-z0-9_]+" placeholder="hello_world"></label><label>Idioma<input name="language" value="pt_BR" required></label><label>Parâmetros do corpo (um por linha, na ordem)<textarea name="parameters" rows="3"></textarea></label><button class="primary" type="submit">Enviar template</button></form>');
  bindForm('#template-form', async data => { const result = await api(`/conversations/${encoded(c.id)}/template`, { method:'POST', body:body({ name:data.name, language:data.language, parameters:data.parameters ? data.parameters.split('\n') : [] }) }); $('#modal').close(); if (session.active?.id === c.id) { session.messages.push(result); drawMessages(); } notice('Template enviado ao provedor. Aguarde a confirmação de entrega.'); });
}
function openPage(page) {
  session.page = page; session.active = null; session.generation++;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page)); $('.inbox').style.display = 'none';
  const titles = { connections:['Conexões','Gerencie os canais e números da sua empresa.'], settings:['Configurações','Expediente, automações e integrações.'], users:['Operadores','Acessos e disponibilidade da equipe.'], billing:['Mensalidades','Acompanhe as cobranças da sua empresa no Asaas.'], logs:['Logs de conversas','Identifique quem finalizou cada atendimento.'], funnel:['Funil de atendimento','Organize as conversas por etapa.'], reports:['Relatórios','Indicadores da sua operação.'] };
  const [title, sub] = titles[page]; const chat = $('#chat'); chat.className = 'page';
  chat.innerHTML = `<header class="page-header"><p class="eyebrow">PAINEL NODUS</p><h1>${title}</h1><p>${sub}</p></header><div class="page-content" id="page-content"><p class="loading">Carregando…</p></div>`;
  ({ connections:connectionsPage, settings:settingsPage, users:usersPage, billing:billingPage, logs:logsPage, funnel:funnelPage, reports:reportsPage })[page]().catch(err => { if (session.page === page) $('#page-content').textContent = err.message; });
}
async function connectionsPage() {
  $('#page-content').innerHTML = `<div class="page-grid"><section class="card"><h2>Novo canal</h2><form id="channel-form"><label>Nome<input name="name" required maxlength="100"></label><label>Conexão<select name="type" id="channel-type"><option value="QR_EVOLUTION">WhatsApp via QR Code</option><option value="OFFICIAL_META">API oficial da Meta</option></select></label><div id="meta-fields"></div><button type="submit" class="primary">Criar conexão →</button></form><p class="muted">Coexistência permite manter o WhatsApp Business no celular. O cadastro depende da elegibilidade e do fluxo oficial da Meta; ainda não está habilitado neste painel.</p></section><section class="card"><div class="section-title"><h2>Meus canais</h2><button id="reload-channels" class="outline">Atualizar lista</button></div><div id="channel-list"></div></section></div>`;
  $('#channel-type').onchange = e => { $('#meta-fields').innerHTML = e.target.value === 'OFFICIAL_META' ? '<label>Phone Number ID<input name="phoneNumberId" required></label><label>Token de acesso<input name="accessToken" type="password" autocomplete="off" required></label><label>WABA ID<input name="wabaId"></label>' : ''; };
  bindForm('#channel-form', async (data, form) => { if (!data.wabaId) delete data.wabaId; await api('/channels', { method:'POST', body:body(data) }); form.reset(); $('#meta-fields').innerHTML = ''; await drawChannels(); notice('Canal criado. Ele já está disponível na lista.'); });
  $('#reload-channels').onclick = e => busy(e.currentTarget, drawChannels);
  await drawChannels();
}
async function drawChannels() {
  const rows = await api('/channels'); if (session.page !== 'connections') return;
  const el = $('#channel-list'); el.innerHTML = rows.map(c => `<article class="connection-card"><div class="section-title"><strong>${escape(c.name)}</strong><span class="status">${escape(c.status === 'PENDING' ? 'Aguardando conexão' : labels[c.status] || c.status)}</span></div><p>${escape(c.phoneNumber || 'Número ainda não consultado')} · ${c.type === 'QR_EVOLUTION' ? 'QR Code' : 'API oficial'}</p><div class="actions"><button class="outline" data-action="refresh" data-id="${escape(c.id)}">Consultar conexão</button>${c.type === 'QR_EVOLUTION' ? `<button class="outline" data-action="qr" data-id="${escape(c.id)}">QR Code</button><button class="outline" data-action="restart" data-id="${escape(c.id)}">Reconectar</button><button class="outline" data-action="disconnect" data-id="${escape(c.id)}">Desconectar</button>` : `<button class="outline" data-action="token" data-id="${escape(c.id)}">Atualizar token</button>`}<button class="outline" data-action="auto" data-id="${escape(c.id)}">Resposta automática</button><button class="outline danger" data-action="delete" data-id="${escape(c.id)}">Excluir canal</button></div></article>`).join('') || '<p class="no-results">Nenhum canal cadastrado.</p>';
  $$('[data-action]', el).forEach(btn => btn.onclick = () => busy(btn, async () => {
    const c = rows.find(c => c.id === btn.dataset.id), action = btn.dataset.action;
    if (action === 'qr') return getQr(c.id);
    if (action === 'auto') return autoReply(c);
    if (action === 'token') { modal('Atualizar token Meta', '<form id="meta-token-form"><label>Novo token<input type="password" name="accessToken" required autocomplete="off"></label><button class="primary" type="submit">Validar e salvar</button></form>'); bindForm('#meta-token-form', async data => { await api(`/channels/${encoded(c.id)}/meta-token`, { method:'PATCH', body:body(data) }); $('#modal').close(); notice('Token atualizado.'); }); return; }
    if (action === 'delete' && !confirm('Excluir o canal e todo o histórico local de suas conversas? Esta ação não pode ser desfeita.')) return;
    if (action === 'disconnect' && !confirm('Desconectar este WhatsApp? Será necessário ler um novo QR Code para conectá-lo novamente.')) return;
    await api(`/channels/${encoded(c.id)}${action === 'delete' ? '' : `/${action}`}`, { method:action === 'delete' ? 'DELETE' : 'POST' });
    await drawChannels(); notice(action === 'restart' ? 'Reconexão solicitada. Consulte o estado em alguns segundos.' : 'Canal atualizado.');
  }));
}
async function getQr(id) {
  const qr = await api(`/channels/${encoded(id)}/qrcode`);
  const value = qr.base64 || '';
  const safe = /^(data:image\/png;base64,)?[A-Za-z0-9+/=\r\n]+$/.test(value) ? (value.startsWith('data:') ? value : `data:image/png;base64,${value}`) : null;
  modal('Conectar WhatsApp', `${safe ? `<img src="${safe}" alt="QR Code para conectar o canal">` : '<p>QR Code indisponível. Se o número já estiver conectado, consulte a conexão. Caso contrário, aguarde e gere outro código.</p>'}<p>WhatsApp → Dispositivos conectados → Conectar dispositivo.</p><button class="primary" id="check-qr">Já conectei — consultar</button>`);
  $('#check-qr').onclick = e => busy(e.currentTarget, async () => { await api(`/channels/${encoded(id)}/refresh`, { method:'POST' }); $('#modal').close(); await drawChannels(); });
}
function autoReply(c) {
  modal('Mensagem de boas-vindas', `<form id="auto-form"><label class="checkbox"><input type="checkbox" name="enabled" ${c.autoReplyEnabled ? 'checked' : ''}>Ativar resposta no início de uma conversa</label><label>Mensagem<textarea name="message" maxlength="4000" rows="5">${escape(c.autoReplyMessage || '')}</textarea></label><button type="submit" class="primary">Salvar</button></form>`);
  bindForm('#auto-form', async data => { await api(`/channels/${encoded(c.id)}/auto-reply`, { method:'PATCH', body:body({ enabled:data.enabled === 'on', message:data.message }) }); $('#modal').close(); await drawChannels(); notice('Resposta automática salva.'); });
}
function scheduleFields(s = {}, prefix = '') {
  const days = s.days || [1,2,3,4,5];
  return `<label class="checkbox"><input type="checkbox" name="${prefix}enabled" ${s.enabled ? 'checked' : ''}>Restringir ao horário abaixo</label><div class="days">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d,i) => `<label class="checkbox"><input type="checkbox" name="${prefix}day${i}" ${days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div><div class="two-fields"><label>Início<input type="time" name="${prefix}start" value="${escape(s.start || '08:00')}" required></label><label>Fim<input type="time" name="${prefix}end" value="${escape(s.end || '18:00')}" required></label></div>`;
}
function scheduleData(data, prefix = '') { return { enabled:data[`${prefix}enabled`] === 'on', days:[0,1,2,3,4,5,6].filter(i => data[`${prefix}day${i}`] === 'on'), start:data[`${prefix}start`], end:data[`${prefix}end`] }; }
async function usersPage() {
  $('#page-content').innerHTML = '<div class="page-grid"><section class="card"><h2>Novo operador</h2><form id="user-form"><label>Nome<input name="name" minlength="2" required></label><label>E-mail<input name="email" type="email" required></label><label>Perfil<select name="role"><option value="AGENT">Operador</option><option value="ADMIN">Administrador</option></select></label><label>Senha temporária (opcional)<input name="temporaryPassword" type="password" minlength="12" autocomplete="new-password" placeholder="Deixe vazio para gerar automaticamente"></label><p class="muted">O acesso será enviado por e-mail. A senha também será exibida uma única vez. A troca é obrigatória no primeiro acesso.</p><button class="primary" type="submit">Criar acesso</button></form></section><section class="card"><h2>Equipe</h2><div id="user-list"></div></section></div>';
  bindForm('#user-form', async (data, form) => { data.email = data.email.trim().toLowerCase(); if (!data.temporaryPassword) delete data.temporaryPassword; const result = await api('/users', { method:'POST', body:body(data) }); form.reset(); secretDialog('Acesso criado', result.temporaryPassword, result.invitationEmailStatus === 'accepted' ? `O Resend aceitou o envio do acesso para ${result.email}. Confira a caixa de entrada e o spam. A troca da senha é obrigatória.` : `O usuário foi criado, mas o envio por e-mail ${result.invitationEmailStatus === 'not_configured' ? 'não está configurado' : 'não foi confirmado'}. Repasse esta senha a ${result.email} por um canal privado ou use Esqueci minha senha. Não cadastre o usuário novamente.`); await drawUsers(); });
  await drawUsers();
}
async function drawUsers() {
  const users = await api('/users'); if (session.page !== 'users') return;
  $('#user-list').innerHTML = users.map(u => `<article class="data-row"><div><strong>${escape(u.name)}</strong><p>${escape(u.email)} · ${u.role === 'ADMIN' ? 'Administrador' : 'Operador'}</p><p>${u.availability?.available === false ? 'Indisponível' : 'Disponível conforme expediente'}</p></div><button class="outline" data-user="${escape(u.id)}">Disponibilidade</button></article>`).join('');
  $$('[data-user]').forEach(btn => btn.onclick = () => {
    const u = users.find(u => u.id === btn.dataset.user), a = u.availability || {};
    modal(`Disponibilidade — ${u.name}`, `<form id="availability-form"><label class="checkbox"><input type="checkbox" name="available" ${a.available !== false ? 'checked' : ''}>Receber encaminhamentos automáticos</label>${scheduleFields(a)}<p class="muted">O fuso é o da empresa. O expediente da empresa também será respeitado.</p><button class="primary" type="submit">Salvar</button></form>`);
    bindForm('#availability-form', async data => { await api(`/workspace/users/${encoded(u.id)}/availability`, { method:'PATCH', body:body({ ...scheduleData(data), available:data.available === 'on' }) }); $('#modal').close(); await drawUsers(); });
  });
}
async function settingsPage() {
  const [settings, users] = await Promise.all([api('/workspace'), api('/users')]); if (session.page !== 'settings') return;
  $('#page-content').innerHTML = `<div class="page-grid"><section class="card"><h2>Expediente e automações</h2><form id="settings-form"><label>Fuso horário<input name="timezone" value="${escape(settings.timezone)}" required></label>${scheduleFields(settings.businessHours)}<label>Resposta fora do expediente<textarea name="awayMessage" maxlength="4000" rows="4">${escape(settings.awayMessage)}</textarea></label><p class="muted">Enviada ao iniciar uma conversa fora do horário. Horários que passam da meia-noite são aceitos.</p><h2>Etapas do funil</h2><p class="muted">Quando o cliente enviar a palavra-chave exata, a conversa muda de etapa e recebe a mensagem configurada. O operador só é atribuído se estiver disponível. Sem disponibilidade, a conversa permanece na fila.</p><div id="stage-fields"></div><button type="button" class="outline" id="add-stage">+ Adicionar etapa</button><button class="primary" type="submit">Salvar configurações</button></form></section><section class="card"><h2>Integração — API aberta</h2><p class="muted">Crie uma chave para integrar o seu sistema. A chave concede acesso aos dados da sua empresa e deve ficar no servidor da integração.</p><form id="key-form"><label>Nome da integração<input name="name" required maxlength="100" placeholder="Meu CRM"></label><button class="primary" type="submit">Gerar chave de API</button></form><div id="keys-list"></div><p class="muted">Base: ${escape(API_URL)}/public/v1<br>Autenticação: Authorization: Bearer SUA_CHAVE</p></section></div>`;
  const addStage = (s = { id:crypto.randomUUID(), name:'', keyword:'', message:'' }) => {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'stage-editor'; fieldset.dataset.id = s.id;
    fieldset.innerHTML = `<legend>Etapa</legend><label>Nome<input data-field="name" value="${escape(s.name)}" maxlength="60" required></label><label>Palavra-chave (opcional)<input data-field="keyword" value="${escape(s.keyword)}" maxlength="100" placeholder="Ex.: vendas"></label><label>Mensagem ao entrar automaticamente<textarea data-field="message" maxlength="4000" rows="3">${escape(s.message)}</textarea></label><label>Operador<select data-field="userId"><option value="">Manter na fila</option>${users.map(u => `<option value="${escape(u.id)}" ${s.userId === u.id ? 'selected' : ''}>${escape(u.name)}</option>`).join('')}</select></label><button type="button" class="text-button danger">Remover etapa</button>`;
    $('button', fieldset).onclick = () => fieldset.remove(); $('#stage-fields').append(fieldset);
  };
  settings.stages.forEach(addStage);
  $('#add-stage').onclick = () => { if ($$('.stage-editor').length >= 20) return notice('Limite de 20 etapas.'); addStage(); };
  bindForm('#settings-form', async data => {
    const stages = $$('.stage-editor').map(el => { const s = { id:el.dataset.id }; $$('[data-field]', el).forEach(input => s[input.dataset.field] = input.value); if (!s.userId) delete s.userId; return s; });
    await api('/workspace', { method:'PATCH', body:body({ timezone:data.timezone, businessHours:scheduleData(data), awayMessage:data.awayMessage, stages }) }); notice('Configurações salvas.');
  });
  bindForm('#key-form', async (data, form) => { const key = await api('/api-keys', { method:'POST', body:body(data) }); form.reset(); await drawKeys(); secretDialog('Chave criada', key.key, 'Guarde esta chave em local seguro. Ela só aparece agora.'); });
  await drawKeys();
}
async function drawKeys() {
  const rows = await api('/api-keys'); if (session.page !== 'settings') return;
  $('#keys-list').innerHTML = rows.map(k => `<article class="data-row"><div><strong>${escape(k.name)}</strong><p>${escape(k.keyPrefix)}… · ${k.revokedAt ? 'Revogada' : 'Ativa'}</p></div>${!k.revokedAt ? `<button class="outline danger" data-key="${escape(k.id)}">Revogar</button>` : ''}</article>`).join('');
  $$('[data-key]').forEach(btn => btn.onclick = () => busy(btn, async () => { if (!confirm('Revogar esta chave? A integração deixará de acessar a API.')) return; await api(`/api-keys/${encoded(btn.dataset.key)}`, { method:'DELETE' }); await drawKeys(); }));
}
async function funnelPage() {
  const [settings, open, pending] = await Promise.all([api('/workspace'), api('/conversations?status=OPEN'), api('/conversations?status=PENDING')]); if (session.page !== 'funnel') return;
  const rows = [...open, ...pending]; const stages = [{ id:'', name:'Sem etapa' }, ...settings.stages];
  $('#page-content').innerHTML = `<p class="muted">Mostrando até 100 conversas abertas e 100 aguardando, das mais recentes. Mover uma conversa aqui não envia mensagem. Configure mensagens por palavra-chave em Configurações.</p><div class="funnel-board">${stages.map(s => `<section class="card funnel-column"><h2>${escape(s.name)}</h2>${rows.filter(c => s.id ? c.funnelStage === s.id : !settings.stages.some(x => x.id === c.funnelStage)).map(c => `<article class="funnel-item"><strong>${escape(c.contact.name || c.contact.waId)}</strong><p>${escape(c.lastMessage?.body || 'Sem mensagens')}</p><label>Etapa<select data-conversation="${escape(c.id)}"><option value="" disabled ${!c.funnelStage ? 'selected' : ''}>Selecionar etapa</option>${settings.stages.map(x => `<option value="${escape(x.id)}" ${x.id === c.funnelStage ? 'selected' : ''}>${escape(x.name)}</option>`).join('')}</select></label></article>`).join('') || '<p class="muted">Sem conversas nesta etapa.</p>'}</section>`).join('')}</div>`;
  $$('[data-conversation]').forEach(select => select.onchange = async () => { select.disabled = true; try { await api(`/conversations/${encoded(select.dataset.conversation)}/stage`, { method:'PATCH', body:body({ stageId:select.value }) }); await funnelPage(); } catch (err) { notice(err.message); select.disabled = false; } });
}
async function logsPage() {
  let cursor = null;
  $('#page-content').innerHTML = '<section class="card"><div id="logs-list"></div><button class="outline" id="more-logs">Carregar mais</button></section>';
  const load = async () => {
    const rows = await api(`/conversations?status=RESOLVED${cursor ? `&cursor=${encoded(cursor)}` : ''}`); if (session.page !== 'logs') return;
    $('#logs-list').insertAdjacentHTML('beforeend', rows.map(c => `<article class="data-row"><div class="avatar">✓</div><div><strong>${escape(c.contact.name || c.contact.waId)}</strong><p>${escape(c.lastMessage?.body || '')}</p><p>Finalizado por: <strong>${escape(c.resolvedByName || 'Não registrado (histórico anterior)')}</strong><br>${escape(date(c.resolvedAt))}</p></div><span class="role">${escape(c.channel.name)}</span></article>`).join('') || (!cursor ? '<p class="muted">Nenhuma conversa finalizada.</p>' : ''));
    cursor = rows.at(-1)?.id; $('#more-logs').hidden = rows.length < 100;
  };
  $('#more-logs').onclick = e => busy(e.currentTarget, load); await load();
}
function invoiceLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'asaas.com' || url.hostname.endsWith('.asaas.com')) ? url.href : null; } catch { return null; }
}
async function billingPage() {
  const status = await api('/billing/status'); if (session.page !== 'billing') return;
  const states = { PENDING:'Em aberto', OVERDUE:'Vencida', RECEIVED:'Paga', CONFIRMED:'Pagamento confirmado', RECEIVED_IN_CASH:'Paga em dinheiro', REFUNDED:'Estornada', REFUND_REQUESTED:'Estorno solicitado', CHARGEBACK_REQUESTED:'Contestada', DELETED:'Excluída', CANCELLED:'Cancelada' };
  $('#page-content').innerHTML = `<div class="metrics"><article><small>Plano</small><strong>${escape(status.plan.name)}</strong></article><article><small>Mensalidade atual</small><strong>${money(status.plan.priceCents / 100)}</strong></article><article><small>Assinatura</small><strong>${escape(status.subscription?.status || 'Não contratada')}</strong></article></div>${status.tenantStatus === 'SUSPENDED' ? '<p class="form-error">Acesso aos atendimentos suspenso. Regularize as cobranças e entre novamente após a confirmação do pagamento.</p>' : ''}<section class="card"><h2>Histórico de cobranças</h2><p class="muted">Cobranças vinculadas ao cliente Asaas desta empresa, incluindo cobranças avulsas. Atualizadas ao abrir esta tela.</p><p id="billing-count" class="muted"></p><div id="payments-list"></div><button id="more-payments" class="outline">Carregar mais</button></section>`;
  let offset = 0, paid = 0, loaded = 0;
  const load = async () => {
    const result = await api(`/billing/payments?offset=${offset}`); if (session.page !== 'billing') return;
    loaded += result.data.length; paid += result.data.filter(p => ['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(p.status)).length;
    $('#billing-count').textContent = `${loaded} de ${result.totalCount} cobranças carregadas · ${paid} pagas/confirmadas entre as carregadas`;
    $('#payments-list').insertAdjacentHTML('beforeend', result.data.map(p => { const url = invoiceLink(p.invoiceUrl); return `<article class="data-row"><div><strong>${money(p.value)} · ${escape(states[p.status] || p.status)}</strong><p>${escape(p.description || 'Cobrança Nodus')}</p><p>Vencimento: ${escape(p.dueDate)}${p.paymentDate ? ` · Pagamento: ${escape(p.paymentDate)}` : ''}</p></div>${url ? `<a class="outline" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Ver cobrança ↗</a>` : ''}</article>`; }).join('') || (!offset ? '<p class="muted">Nenhuma cobrança encontrada.</p>' : ''));
    offset += result.data.length; $('#more-payments').hidden = !result.hasMore;
  };
  $('#more-payments').onclick = e => busy(e.currentTarget, load); await load();
}
async function reportsPage() {
  const r = await api('/reports/summary'); if (session.page !== 'reports') return;
  const counts = r.conversationsByStatus || {};
  $('#page-content').innerHTML = `<div class="metrics">${['OPEN','PENDING','RESOLVED'].map(k => `<article><small>${labels[k]}</small><strong>${escape(counts[k] || 0)}</strong></article>`).join('')}<article><small>Primeira resposta média</small><strong>${escape(r.averageFirstResponseMinutes == null ? '—' : `${r.averageFirstResponseMinutes} min`)}</strong></article></div><section class="card"><h2>Mensagens nos últimos 7 dias</h2>${(r.messagesLast7Days || []).map(x => `<div class="data-row"><strong>${escape(x.date)}</strong><span>${escape(x.count)} mensagens</span></div>`).join('')}</section>`;
}
function logout(revoke = false) {
  if (revoke && session.token) api('/auth/logout-all', { method:'POST', body:'{}' }).catch(() => notice('Você saiu deste navegador, mas não foi possível revogar as outras sessões.'));
  session.token = null; session.user = null; session.tenant = null; session.active = null; session.conversations = []; session.messages = []; $('#modal')?.close(); renderLogin();
}
async function startApp() {
  const identity = await api('/auth/me'); session.user = identity.user; session.tenant = identity.tenant;
  renderShell(); if (identity.tenant.status === 'SUSPENDED') openPage('billing'); else await loadConversations();
}
// Refresh the open chat only. No polling while hidden or unauthenticated.
let polling = false;
setInterval(async () => {
  if (document.hidden || polling || !session.token || !session.active || session.page) return;
  polling = true; const id = session.active.id, generation = session.generation;
  try {
    const rows = await api(`/conversations/${encoded(id)}/messages`);
    if (generation !== session.generation || session.active?.id !== id) return;
    const el = $('#messages'), bottom = el && el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    const byId = new Map(session.messages.map(m => [m.id,m])); rows.forEach(m => byId.set(m.id,m)); session.messages = [...byId.values()];
    drawMessages(bottom);
  } catch (err) { if (err.status !== 401) notice(err.status === 429 ? 'Atualização pausada pelo limite de requisições. Aguarde.' : err.message); }
  finally { polling = false; }
}, 30000);
const resetToken = new URLSearchParams(location.hash.slice(1)).get('reset');
resetToken ? resetPassword(resetToken) : renderLogin();
