# Responsável e encaminhamento de atendimentos

## Funcionamento

- Conversas sem atendente ficam na fila da empresa e podem ser assumidas pelos operadores.
- Ao clicar em **Assumir**, a conversa passa a ficar disponível ao responsável e aos administradores da mesma empresa. O nome aparece abaixo do contato, na lista e no cabeçalho.
- O operador não pode consultar, alterar, enviar mensagens, baixar anexos, abrir fotos ou ler/escrever observações de uma conversa atribuída a outro operador, mesmo conhecendo seu ID.
- O administrador continua com acesso a todas as conversas da empresa e pode assumir ou encaminhar atendimentos.
- **Encaminhar** abre a seleção dos usuários da mesma empresa. O operador precisa ser o responsável atual; administradores podem encaminhar diretamente. O histórico e as observações permanecem na mesma conversa.
- O encaminhamento para um setor continua liberando o responsável e devolvendo o atendimento à fila.
- Atendimentos finalizados não podem ser assumidos nem encaminhados. A restrição de leitura por responsável também se aplica ao histórico finalizado.
- Duas tentativas simultâneas de assumir a mesma conversa são serializadas no banco. A segunda tentativa de outro operador é recusada.
- Assumir interrompe a automação pendente da conversa. A atribuição e o encaminhamento ficam registrados na auditoria.

A atualização visual usa a consulta periódica já existente: em condições normais, a conversa aberta é verificada a cada 5 segundos, a lista a cada 10 segundos e o funil automático a cada 15 segundos. As consultas aguardam a anterior terminar e podem atrasar por latência, falha de rede ou limite de requisições. Não é necessário F5. A autorização no backend passa a valer assim que a atribuição é concluída, independentemente da atualização visual. Telas históricas estáticas são filtradas ao consultar novamente; conteúdo já exibido não pode ser recolhido de um navegador externo.

## Publicação

1. Faça o merge do PR e aguarde o deploy do backend no Render.
2. Substitua os arquivos do app na Hostinger pelo conteúdo de `frontend/`, incluindo `conversation-assignment.js`, `app.js`, `index.html` e `pages.css`.
3. Preserve a pasta `owner/` como pasta, dentro do app; não coloque seus arquivos na raiz do app.
4. Limpe o cache da hospedagem e recarregue o navegador.

Esta alteração não precisa de novas variáveis, seed ou migrações. O site institucional não é alterado.

## Homologação com três contas

1. Entre com um administrador e dois operadores da mesma empresa, em navegadores/perfis separados.
2. Na fila, o operador A assume uma conversa. Confira o nome abaixo do contato.
3. No operador B, aguarde a atualização automática: a conversa deve desaparecer. Se estava aberta, o painel deve ser fechado. Uma consulta direta ao ID com o JWT de B deve retornar 404.
4. No administrador, confira que a conversa continua disponível e mostra A como responsável.
5. No operador A, clique em **Encaminhar**, selecione B e confirme.
6. A perde o acesso; B recebe o mesmo atendimento, com o histórico e as observações. O administrador continua vendo a conversa com o nome de B.
7. Tente assumir a mesma conversa sem responsável em dois navegadores ao mesmo tempo: apenas um operador deve conseguir.
8. Confira um atendimento de outra empresa: nem um administrador pode acessá-lo.

## Contrato HTTP do app

As rotas abaixo usam o JWT do usuário autenticado, preservando o isolamento por empresa:

- `GET /conversations`: fila + próprias conversas para AGENT; todas da empresa para ADMIN. Retorna `assignedUserId` e `assignedUser: {id, name}` (ou null).
- `PATCH /conversations/:id/assign` com `{}`: assumir para o usuário atual.
- `POST /conversations/:id/transfer` com `{"userId":"UUID_DO_DESTINATARIO"}`: encaminhar ao usuário da mesma empresa.
- `POST /conversations/visibility` com `{"ids":["UUID_DA_CONVERSA"]}`: revalidar os atendimentos armazenados na interface, incluindo páginas antigas. Até 500 IDs únicos por consulta. Retorna somente os ainda acessíveis, com status e responsável.

Sem acesso à conversa: 404. Disputa detectada após o bloqueio transacional: 409. Destino de outra empresa, transferência sem assumir ou atendimento finalizado: 403. Campos inválidos: 400.

A API pública autenticada por chave da empresa mantém o acesso de integração no escopo da empresa. Ela não representa uma sessão de operador; suas chaves continuam sob administração da empresa. As rotas públicas existentes não foram removidas ou renomeadas.

## Verificações automatizadas

- Testes HTTP das permissões em mensagens, fotos, anexos, observações, atribuição, encaminhamento, exclusão e alterações do atendimento.
- Testes de isolamento entre empresas, atribuição concorrente, destinos inválidos, auditoria, criação de conversa existente e listagem antes da paginação.
- Regressões de conversas, automações, anexos e API pública.
- Compilação TypeScript, sintaxe dos módulos do frontend e reconciliação das páginas armazenadas no navegador.

A homologação visual com as três contas ainda deve ser feita no ambiente publicado.
