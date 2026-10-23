export function assignmentLabel(conversation) {
  return conversation.assignedUserId ? `Em atendimento por ${conversation.assignedUser?.name || 'atendente'}` : 'Na fila · Sem atendente';
}

// Re-check all cached pages, including rows older than the current first page.
export function reconcileAssignments(conversations, visibleRows) {
  const visible=new Map(visibleRows.map(row=>[row.id,row]));
  return conversations.filter(row=>visible.has(row.id)).map(row=>({...row,...visible.get(row.id)}));
}

export function canReply(conversation, userId) {
  return !!userId && conversation?.status !== 'RESOLVED' && conversation?.assignedUserId === userId;
}
export function replyInstruction(conversation) {
  return conversation?.status === 'RESOLVED' ? 'Atendimento finalizado. Use Nova conversa para continuar.' : 'Clique em Assumir para responder a este contato.';
}
