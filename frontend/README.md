# Painel Nodus

Frontend estático: publique estes arquivos no subdomínio HTTPS do sistema. Sem build Node ou banco no navegador. Backend e migração desta versão precisam ser publicados primeiro.

Veja `../FRONTEND-ATUALIZACAO.md` para implantação, variáveis do e-mail, CORS, limites da coexistência e roteiro de homologação.

A URL pública do backend é definida em `index.html`. Não adicione segredos aqui.

Atualização v9: conta pessoal, administrador principal protegido, setores, etapas condicionais e campanhas/follow-ups. Publique o backend e suas duas novas migrações antes de substituir este frontend. O guia está em `docs/GUIA-AUTOMACOES-CAMPANHAS.md` no repositório/pacote. Para campanhas, ative `CAMPAIGNS_WORKER_ENABLED=true` no backend apenas depois de revisar os agendamentos de teste.

Atualização v10: abas em Configurações (E-mail, Senha, Expediente, Integrações), Conexões, Operadores, Automações, Campanhas e Relatórios. Alternar abas preserva os formulários. Setas, Home e End navegam pelo teclado. Esta atualização visual não exige nova migração; mantenha o backend v9 já publicado. Na Hostinger substitua o conteúdo do frontend e recarregue a página.

Atualização v11: listagem de automações com palavra-chave, etapa anterior, prévia da resposta e destino. Abra um item para editar. Nova automação cria uma etapa independente; Criar próxima etapa já vincula a etapa anterior. Clique em Salvar automações para aplicar. Limite existente: 20 etapas por empresa. Sem palavra-chave, a etapa é manual. Uma etapa com dependentes só pode ser removida após ajustar as referências. Sem mudança de banco.

Atualização v12: opção Aguardar resposta livre do cliente. Publique primeiro o backend e a migração 20261005120000_free_response (migrate deploy). Depois substitua o frontend. Informe pergunta, setor e confirmação; marque a opção e salve. A próxima mensagem de texto confirma e encaminha sem operador atribuído. Após isso as automações param nesta conversa; uma nova conversa começa outro fluxo. Áudio/imagem sem texto não concluem a espera. Respostas a perguntas já iniciadas são aceitas mesmo fora do expediente. Operador assumindo interrompe o fluxo automático.


Atualização v13: em Conexões, Grupos permite aceitar ou ignorar novas mensagens de grupos por canal QR Code (apenas administradores). Canais existentes continuam recebendo até desativar. Histórico preservado; mensagens ignoradas não disparam automação nem webhook externo. Em Automações > Boas-vindas, Somente quando o cliente iniciar a conversa fica marcado por padrão; desmarcar permite saudar a primeira resposta em uma conversa aberta pela equipe. Abrir conversa nunca envia a saudação sozinho. A identificação considera os atendimentos abertos na plataforma; mensagens enviadas diretamente pelo celular não são importadas como atendimentos de saída. Nova conversa aceita DDD + número brasileiro, acrescentando 55, e números internacionais com +DDI. Essa normalização também vale para POST /public/v1/conversations: números internacionais devem ter + explícito. Não há migração nova nem seed: faça deploy do backend antes de substituir o frontend.

Atualização v14 — fotos dos contatos: a lista e o cabeçalho carregam fotos de contatos individuais dos canais Evolution conectados, sob demanda. GET /conversations/:id/photo exige JWT e valida empresa/contato antes de cada leitura, inclusive cache. A chave Evolution permanece no backend. URLs HTTPS limitadas a whatsapp.net são exibidas diretamente pelo navegador, sem Authorization ou Referer para o CDN; não há proxy de imagem nem download de URL arbitrária no servidor. Não persistimos fotos/URLs no banco. Cache em memória: URL até 5 minutos, indisponibilidade 1 minuto, até 500 entradas e 8 consultas simultâneas por processo. No navegador: até 200 entradas por sessão, 1 minuto e 3 consultas simultâneas; sair apaga o cache e cancela consultas. Fotos privadas, erros, grupos e canais Meta usam iniciais. URLs que não carregam também usam iniciais. Publicar backend primeiro e enviar TODOS os arquivos do frontend (inclusive contact-photos.js) para app.nodusintegracao.com. Sem novas variáveis, seed ou migração. A consulta usa POST /chat/fetchProfilePictureUrl/{instance} com {number}, compatível com Evolution v2; validação na instância real permanece necessária após o deploy.

Atualização v15 — contatos para campanhas e follow-ups: na criação da campanha, busque por nome/telefone e filtre canal do histórico, setor ou etapa. Selecione contatos com mensagens anteriores; a seleção permanece ao trocar filtros. Em Selecionados, ajuste nomes só para aquela campanha. A inclusão manual é opcional e pode complementar um contato selecionado com link/valor, sem duplicar o envio. Limite combinado: 100 destinatários. Contatos sem nome aparecem pelo telefone; para usar {{nome}}, preencha o nome.

Pedidos SAIR, PARAR, STOP ou CANCELAR (mensagem de texto contendo apenas o comando, sem distinguir maiúsculas) bloqueiam campanhas e follow-ups para o telefone em toda a empresa e cancelam envios na fila. Contatos bloqueados não aparecem na seleção. Há nova conferência imediatamente antes do envio; mensagens já despachadas ao provedor não podem ser recolhidas. O atendimento normal continua disponível. Mensagens TEXT recebem a orientação de saída automaticamente; templates Meta precisam conter essa orientação no modelo aprovado. O opt-out não substitui a autorização prévia, cuja confirmação continua obrigatória. Não há reativação automática.

Implantação v15: publique o backend primeiro e substitua TODOS os arquivos do app na Hostinger, incluindo campaign-contacts.js. Sem novas variáveis, seed ou migrações nesta atualização. Mantenha a configuração existente do worker de campanhas. Homologue com um destinatário de teste autorizado: selecione, confira prévia/lista, agende, responda SAIR e confirme que os follow-ups pendentes foram ignorados. Nenhuma campanha real foi enviada nos testes automatizados.

Atualização v16 — ordem das conversas: a lista lateral mostra primeiro a conversa com a mensagem mais recente (recebida ou enviada). A API aplica a ordem antes da paginação, sem usar alterações de setor, operador ou status como atividade de mensagem. Empates usam o ID; conversas sem mensagens usam a data de criação. Hoje mostra hora; em outros dias mostra data e hora, no fuso do navegador. O histórico dentro da conversa continua da mensagem mais antiga para a mais nova. A atualização periódica da conversa aberta também atualiza sua posição na lista. Publique o backend e depois todos os arquivos do app, incluindo conversation-order.js. Sem migração, seed ou novas variáveis.

Atualização v17 — Configurações > Aparência: Claro, Escuro e Automático para administradores e operadores. O padrão continua escuro. A escolha é salva apenas neste navegador (nodus_theme), acompanha login/logout e sincroniza abas; não é gravada no servidor nem por usuário. Automático acompanha alterações do sistema. Se o armazenamento estiver bloqueado, a troca funciona na sessão. Publique TODOS os arquivos do frontend, incluindo theme.js e theme.css, na Hostinger e limpe o cache. Sem alterações no backend, variáveis, seed ou migrações. O site institucional permanece independente.

Atualização v18 — navegação: as telas são exibidas somente depois de organizar as abas, sem mostrar todos os formulários durante o carregamento. Respostas de uma visita anterior não atualizam uma nova visita à mesma tela. A última subaba selecionada é lembrada durante a sessão; sair da conta limpa essa escolha. Falhas de carregamento oferecem Tentar novamente. Publique todos os arquivos do frontend no subdomínio do app e limpe o cache da Hostinger. Sem alterações no backend, banco ou variáveis.

Atualização v38 — atendimentos por responsável: nome do atendente abaixo do contato, conversas assumidas disponíveis apenas ao responsável e administradores, botão Encaminhar para outro usuário da mesma empresa e atualização automática da lista. Publique primeiro o backend do mesmo PR. Depois substitua todos os arquivos do app, incluindo conversation-assignment.js; mantenha owner/ como subpasta e limpe o cache. Sem novas variáveis, seed ou migrações. Consulte docs/ATENDIMENTOS-PRIVADOS.md no repositório para o roteiro de homologação com dois operadores e um administrador.

Atualização v39 — assumir antes de responder: operadores e administradores precisam ser o responsável atual para enviar texto, anexo ou template pelo app. O campo de resposta explica que é necessário clicar em Assumir. Integrações por chave de API e automações mantêm seu funcionamento. Publicar backend primeiro, substituir o frontend completo e limpar o cache. Sem migração, seed ou novas variáveis.

## Avisos de novas mensagens na aba

1. Faça o merge e aguarde o backend no Render ficar Live. O start com
   `prisma migrate deploy` aplica o índice de consulta de mensagens.
2. Na Hostinger, atualize o app com `index.html`, `app.js`, `pages.css` e
   `message-alerts.js` deste mesmo commit. Preserve o domínio da API configurado
   e os demais arquivos. Não envie estes arquivos à página institucional nem a `/owner/`.
3. Recarregue com Ctrl+F5, entre e clique em **Ativar som** na barra lateral.
   Um toque confirma que o navegador liberou o áudio. **Silenciar som** desativa.
4. Abra outra aba e mande duas mensagens ao WhatsApp conectado. O título deve
   mostrar `(2) Nodus — Atendimento`; ao visualizar as mensagens, o total diminui.
5. Repita com um operador: somente fila sem responsável e conversas próprias
   geram alertas. Administradores recebem as conversas da sua empresa.

O contador representa mensagens recebidas após iniciar esta sessão que ainda
não foram visualizadas nesta aba; não é o total histórico de não lidas do WhatsApp.
Mensagens exibidas na área visível da conversa, com a janela em foco, são retiradas
individualmente. Rolar o histórico revela e retira as demais. Isso não envia
confirmação de leitura ao WhatsApp. Sair/recarregar limpa o contador e exige
reativar o som. Cada aba tem estado e áudio independentes: prefira uma aba aberta.

A consulta ocorre a cada 5 segundos, inclusive em outras páginas do app e em
segundo plano, com paginação de 100 mensagens, deduplicação e recuo após falhas/429.
O navegador pode atrasar ou suspender abas em segundo plano; não há push com o
navegador fechado, computador em suspensão ou sem conexão. Após mais de 24 horas
sem sincronizar, inicia uma nova base sem reproduzir histórico. A sobreposição
entre consultas tolera commits atrasados até 30 segundos; não é um log durável
de entrega de notificações. Nenhuma mensagem, telefone ou credencial fica no
armazenamento do navegador para este recurso.

Validação automatizada:
- `node tests/frontend/message-alerts.cjs`
- `node tests/frontend/auto-refresh.cjs`
- `node node_modules/jest/bin/jest.js --runInBand src/conversations/incoming-alerts.spec.ts src/conversations/conversation-access.spec.ts`
- `npm run build`

## Histórico contínuo após finalizar

A tela usa `GET /conversations/:id/history`: mostra o atendimento atual e os
atendimentos anteriores já finalizados do mesmo contato e canal, em ordem de data
com paginação (Carregar mensagens anteriores). O usuário deve ter acesso ao
atendimento atual. Esse acesso concede contexto de leitura dos casos anteriores,
inclusive os atendidos por outros operadores; não concede edição nem acesso a
outros casos ativos. Empresa, canal e contato são conferidos no servidor.

Finalizar mantém o histórico aberto e bloqueia novos envios nesse atendimento.
Uma nova mensagem continua abrindo outro atendimento, preservando os relatórios,
responsáveis e datas de finalização, mas o novo atendimento mostra o histórico
anterior com a indicação "Atendimento anterior". Anexos históricos passam por
verificação equivalente antes do download; mídias expiradas no provedor podem
não estar mais disponíveis. Exclusão explícita e retenção continuam valendo:
esta mudança não recupera mensagens já removidas do banco.

Publicação: primeiro deploy do backend; depois atualizar index.html e app.js na
Hostinger. O pacote inclui também os arquivos de alertas da versão anterior para
manter a instalação compatível. Não há nova migração de banco nesta correção.
