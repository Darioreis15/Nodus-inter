# Atualização automática das conversas

O app atualiza as mensagens do chat aberto aproximadamente a cada 5 segundos e a primeira página da lista a cada 10 segundos, enquanto a aba está visível e a sessão está ativa. Também consulta a lista sem uma conversa aberta. São consultas periódicas autenticadas, não WebSocket/SSE; os intervalos aumentam com demora de rede, erros ou limitação de requisições.

O texto do compositor não é refeito e o histórico não pula para o fim se o operador estiver lendo mensagens anteriores. As páginas antigas carregadas continuam disponíveis; a atualização automática da lista cobre os 100 atendimentos mais recentes do filtro. Alterações apenas nos atendimentos fora dessa janela aparecem ao recarregar a lista/página correspondente.

A atualização pausa em outras telas, aba oculta, sessão encerrada ou navegador offline. Ao voltar à aba ou recuperar conexão, tenta atualizar imediatamente, respeitando eventual pausa por erro. Não sobrepõe ciclos automáticos; ignora respostas de navegações/sessões antigas. Em erros, aumenta o intervalo e respeita retryAfter, sem notificações repetidas a cada tentativa. Os limites por IP existentes continuam valendo, inclusive quando vários operadores compartilham a mesma rede.

## Publicar

Envie todos os arquivos do frontend atualizado para a raiz de app.nodusintegracao.com na Hostinger, incluindo auto-refresh.js. Preserve a pasta owner. Limpe o cache e use Ctrl+F5. Esta alteração é somente de frontend, sem migração ou nova variável. Requer o backend atual já publicado.

## Validar

1. Deixe um chat aberto e envie uma mensagem de outro celular. Deve aparecer automaticamente após o recebimento pelo backend, normalmente no próximo ciclo de 5 segundos.
2. Envie mensagem de outro contato: a prévia/lista deve atualizar no próximo ciclo de 10 segundos, sem fechar o chat aberto.
3. Digite uma resposta sem enviar, receba outra mensagem e confirme que seu rascunho continua no campo.
4. Suba o histórico e receba uma mensagem: a tela deve preservar a posição de leitura.
5. Troque rapidamente de chat/filtro e confirme que mensagens de uma conversa não aparecem em outra.
6. Oculte a aba e volte; desligue e religue a rede. A atualização deve retomar automaticamente.

Testes locais: node tests/frontend/auto-refresh.cjs; node --check frontend/app.js; node --check frontend/auto-refresh.js; git diff --check. Validação visual no navegador e recebimento real devem ser feitos após a publicação.
