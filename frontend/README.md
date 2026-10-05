# Painel Nodus

Frontend estático: publique estes arquivos no subdomínio HTTPS do sistema. Sem build Node ou banco no navegador. Backend e migração desta versão precisam ser publicados primeiro.

Veja `../FRONTEND-ATUALIZACAO.md` para implantação, variáveis do e-mail, CORS, limites da coexistência e roteiro de homologação.

A URL pública do backend é definida em `index.html`. Não adicione segredos aqui.

Atualização v9: conta pessoal, administrador principal protegido, setores, etapas condicionais e campanhas/follow-ups. Publique o backend e suas duas novas migrações antes de substituir este frontend. O guia está em `docs/GUIA-AUTOMACOES-CAMPANHAS.md` no repositório/pacote. Para campanhas, ative `CAMPAIGNS_WORKER_ENABLED=true` no backend apenas depois de revisar os agendamentos de teste.

Atualização v10: abas em Configurações (E-mail, Senha, Expediente, Integrações), Conexões, Operadores, Automações, Campanhas e Relatórios. Alternar abas preserva os formulários. Setas, Home e End navegam pelo teclado. Esta atualização visual não exige nova migração; mantenha o backend v9 já publicado. Na Hostinger substitua o conteúdo do frontend e recarregue a página.

Atualização v11: listagem de automações com palavra-chave, etapa anterior, prévia da resposta e destino. Abra um item para editar. Nova automação cria uma etapa independente; Criar próxima etapa já vincula a etapa anterior. Clique em Salvar automações para aplicar. Limite existente: 20 etapas por empresa. Sem palavra-chave, a etapa é manual. Uma etapa com dependentes só pode ser removida após ajustar as referências. Sem mudança de banco.

Atualização v12: opção Aguardar resposta livre do cliente. Publique primeiro o backend e a migração 20261005120000_free_response (migrate deploy). Depois substitua o frontend. Informe pergunta, setor e confirmação; marque a opção e salve. A próxima mensagem de texto confirma e encaminha sem operador atribuído. Após isso as automações param nesta conversa; uma nova conversa começa outro fluxo. Áudio/imagem sem texto não concluem a espera. Respostas a perguntas já iniciadas são aceitas mesmo fora do expediente. Operador assumindo interrompe o fluxo automático.
