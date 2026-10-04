# Painel Nodus

Frontend estático: publique estes arquivos no subdomínio HTTPS do sistema. Sem build Node ou banco no navegador. Backend e migração desta versão precisam ser publicados primeiro.

Veja `../FRONTEND-ATUALIZACAO.md` para implantação, variáveis do e-mail, CORS, limites da coexistência e roteiro de homologação.

A URL pública do backend é definida em `index.html`. Não adicione segredos aqui.

Atualização v9: conta pessoal, administrador principal protegido, setores, etapas condicionais e campanhas/follow-ups. Publique o backend e suas duas novas migrações antes de substituir este frontend. O guia está em `docs/GUIA-AUTOMACOES-CAMPANHAS.md` no repositório/pacote. Para campanhas, ative `CAMPAIGNS_WORKER_ENABLED=true` no backend apenas depois de revisar os agendamentos de teste.
