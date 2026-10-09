const timestamp = c => {
  const value = Date.parse(c.lastMessage?.createdAt || c.createdAt || '');
  return Number.isFinite(value) ? value : 0;
};
export function sortConversations(rows) {
  return [...rows].sort((a,b) => timestamp(b)-timestamp(a) || String(b.id).localeCompare(String(a.id)));
}
export function conversationTime(c, now = new Date()) {
  const time = timestamp(c); if (!time) return '';
  const date = new Date(time);
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})
    : date.toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
}
