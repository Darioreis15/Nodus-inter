# Nodus WhatsApp SaaS — API (Fase 1)

Fundação multi-tenant: autenticação JWT, modelo de tenant/plano, e escopo de
usuários por empresa cliente. Ainda sem WhatsApp — isso é a Fase 2.

## Stack

- Node.js + NestJS + TypeScript
- PostgreSQL via Prisma ORM
- Auth: Passport + JWT, bcrypt para hash de senha
- Rate limiting: @nestjs/throttler (10 tentativas/min, mesmo limite do outro
  SaaS da Nodus)
- Testes: Jest (8 testes unitários já passando)

## Setup local

```bash
npm install
cp .env.example .env
# edite o .env com a URL do seu Postgres local e um JWT_SECRET forte

npx prisma migrate dev --name init
npm run prisma:seed   # cria os planos e um tenant demo
npm run start:dev
```

O seed cria um tenant "demo" com o admin `admin@demo.nodus.dev` / senha
`trocar123` (com troca obrigatória no primeiro login).

> Nesse ambiente de geração eu não tinha acesso à CDN de binários do Prisma
> pra rodar `prisma generate`/`migrate` de fato — mas todo o restante do
> projeto (TypeScript inteiro + os 8 testes) foi compilado e executado com
> sucesso aqui. Rode `npx prisma generate` normalmente na sua máquina antes
> do primeiro `start:dev`; o `postinstall` já não faz isso automaticamente
> neste scaffold, então não esqueça desse passo.

## Endpoints da Fase 1

| Método | Rota                    | Quem acessa      | O que faz                                  |
|--------|-------------------------|------------------|---------------------------------------------|
| POST   | `/auth/register`        | Público          | Cria um novo tenant + primeiro admin        |
| POST   | `/auth/login`           | Público          | Login, retorna JWT                          |
| POST   | `/auth/change-password` | Autenticado      | Troca de senha (obrigatória no 1º login)    |
| GET    | `/auth/me`              | Autenticado      | Dados do usuário + tenant atual             |
| GET    | `/tenants/current`      | Autenticado      | Dados do tenant, plano e contagem de users  |
| GET    | `/users`                | Autenticado      | Lista usuários do próprio tenant            |
| POST   | `/users`                | Admin do tenant  | Cria um novo agente/admin (respeita o limite de assentos do plano) |

## Fase 2 — Conectores de canal

Depois de rodar `npx prisma migrate dev` de novo (agora com os models `Channel`
e `Message`) e `npx prisma generate`, você tem dois jeitos de conectar um
número de WhatsApp, atrás da mesma interface (`ChannelConnector`):

- **QR_EVOLUTION** — cria uma instância numa Evolution API sua (self-hosted,
  https://github.com/EvolutionAPI/evolution-api). Configure
  `EVOLUTION_API_BASE_URL` e `EVOLUTION_API_KEY` no `.env`.
- **OFFICIAL_META** — usa um número já verificado no WhatsApp Business
  Manager. Você mesmo cola o `phoneNumberId` e o `accessToken` na hora de
  criar o canal — não tem passo de "criar instância".

| Método | Rota                          | Quem acessa      | O que faz                                       |
|--------|-------------------------------|------------------|--------------------------------------------------|
| GET    | `/channels`                   | Autenticado      | Lista os canais do tenant                        |
| POST   | `/channels`                   | Admin do tenant  | Cria um canal (respeita `maxChannels` do plano)  |
| GET    | `/channels/:id/qrcode`        | Admin do tenant  | Busca o QR code atual (só canais QR_EVOLUTION)   |
| POST   | `/channels/:id/messages`      | Autenticado      | Envia uma mensagem de texto pelo canal           |
| GET    | `/channels/:id/messages`      | Autenticado      | Lista as últimas 50 mensagens do canal           |
| POST   | `/webhooks/evolution/:channelId` | Público (Evolution API) | Recebe eventos de mensagem/conexão      |
| GET/POST | `/webhooks/meta`            | Público (Meta)   | Verificação do webhook + eventos de mensagem/status |

### Configurando o webhook em cada provedor

- **Evolution API**: acontece sozinho — na criação do canal, o backend já
  registra `APP_BASE_URL/webhooks/evolution/<channelId>` como webhook dessa
  instância.
- **Meta**: precisa configurar manualmente no painel do app (Meta for
  Developers → seu app → WhatsApp → Configuration): URL de callback
  `APP_BASE_URL/webhooks/meta` e o mesmo valor de `META_VERIFY_TOKEN` do seu
  `.env`.

### Sobre os conectores neste scaffold

Os endpoints e formatos de payload da Evolution API foram escritos com base
na v2 documentada publicamente — como o projeto evolui rápido, vale conferir
a versão que você for rodar antes de ir pra produção. A Cloud API da Meta
segue a Graph API `v20.0`; ajuste a constante `GRAPH_API_VERSION` em
`src/channels/connectors/meta.connector.ts` quando a Meta depreciar essa
versão.

> Neste ambiente de geração eu também não tinha acesso à CDN de binários do
> Prisma pra regenerar o client com os novos models — então troquei os
> imports de tipo `Channel` do `@prisma/client` por uma interface própria em
> `src/channels/channel.types.ts`, só pra conseguir compilar e testar aqui.
> Isso não muda nada pra você: rode `npx prisma generate` normalmente depois
> do `migrate dev`, os tipos reais do Prisma continuam funcionando em
> paralelo (o `PrismaService` usa o client de verdade o tempo todo).

## Fase 3 — Inbox e atendimento

Depois de `npx prisma migrate dev` de novo (agora com `Contact` e
`Conversation`, e `Message` migrou de `channelId` pra `conversationId`), o
fluxo de atendimento fica assim:

1. Mensagem chega por um webhook (Evolution ou Meta) → `ConversationsService`
   acha ou cria o `Contact` pelo número, e acha ou cria uma `Conversation`
   `OPEN` pra esse par canal+contato (se já tinha uma `PENDING`, ela volta pra
   `OPEN` — o cliente respondeu de novo).
2. Um agente responde por `POST /conversations/:id/messages` → a mensagem sai
   pelo conector certo (Evolution ou Meta, sem o agente saber qual) e a
   conversa vira `PENDING` (aguardando o cliente).
3. Quando o atendimento acaba, `PATCH /conversations/:id/status` com
   `{"status": "RESOLVED"}` fecha ela.

| Método | Rota                          | O que faz                                            |
|--------|-------------------------------|-------------------------------------------------------|
| GET    | `/conversations`              | Lista conversas do tenant (`?status=`, `?mine=true`)   |
| GET    | `/conversations/:id/messages` | Histórico completo da conversa                         |
| POST   | `/conversations/:id/messages` | Agente responde (marca a conversa como `PENDING`)       |
| PATCH  | `/conversations/:id/assign`   | Atribui a um agente (corpo vazio = atribui a si mesmo) |
| PATCH  | `/conversations/:id/status`   | Muda status: `OPEN`, `PENDING` ou `RESOLVED`           |

> `/channels/:id/messages` (Fase 2) saiu do ar — enviar/ler mensagem agora é
> sempre através de uma conversa, que é o que dá o histórico por contato e a
> fila de atendimento.

## Fase 4 — API aberta

Depois de `npx prisma db push` de novo (agora com `ApiKey` e
`WebhookSubscription`), dois jeitos de um terceiro (ou você mesmo) se
integrar de fora:

### Chaves de API — pra consumir a Nodus

Um admin gera uma chave pelo painel, e ela dá acesso de leitura/escrita nas
conversas do próprio tenant, sem precisar de login/senha.

| Método | Rota                | Quem acessa | O que faz                                          |
|--------|----------------------|-------------|------------------------------------------------------|
| POST   | `/api-keys`          | Admin       | Gera uma chave nova — a chave crua só aparece **uma vez**, nessa resposta |
| GET    | `/api-keys`          | Admin       | Lista as chaves (só o prefixo, nunca a chave inteira) |
| DELETE | `/api-keys/:id`      | Admin       | Revoga a chave                                        |

Com a chave em mãos, a API pública espelha as conversas (autenticada por
`Authorization: Bearer nodus_live_...` em vez de JWT):

| Método | Rota                                  | O que faz                          |
|--------|----------------------------------------|-------------------------------------|
| GET    | `/public/v1/conversations`             | Lista conversas (`?status=`)        |
| GET    | `/public/v1/conversations/:id/messages`| Histórico da conversa                |
| POST   | `/public/v1/conversations/:id/messages`| Manda mensagem pela conversa         |

### Webhooks de saída — pra Nodus avisar você

Um admin cadastra uma URL e os eventos que quer escutar; a Nodus dispara um
`POST` assinado toda vez que acontecem.

| Método | Rota                       | O que faz                                                |
|--------|------------------------------|-------------------------------------------------------------|
| POST   | `/webhook-subscriptions`   | Cadastra `{ url, events: ["message.received", "conversation.assigned"] }` — o `secret` também só aparece uma vez, na criação |
| GET    | `/webhook-subscriptions`   | Lista as assinaturas ativas                                  |
| DELETE | `/webhook-subscriptions/:id` | Desativa (não deleta o histórico)                          |

Cada entrega chega com `X-Nodus-Event` (o nome do evento) e
`X-Nodus-Signature` (HMAC-SHA256 do corpo, usando o `secret` daquela
assinatura) — é assim que o seu sistema confirma que a chamada veio da Nodus
mesmo. Uma entrega que falha (URL fora do ar, timeout) é só logada — nunca
derruba o fluxo principal de mensagens.

## Fase 5 — Billing, respostas automáticas e relatórios

Depois de `npx prisma db push` de novo (agora com `Subscription`, `Plan.priceCents`
e os campos `autoReply*` em `Channel`):

### Respostas automáticas

Configuráveis por canal — dispara só na **primeira** mensagem de uma conversa
nova (não repete a cada mensagem):

| Método | Rota                        | O que faz                                                   |
|--------|-------------------------------|----------------------------------------------------------------|
| PATCH  | `/channels/:id/auto-reply`  | `{ "enabled": true, "message": "Olá! Já te respondemos em breve." }` |

### Relatórios

| Método | Rota               | O que traz                                                              |
|--------|---------------------|---------------------------------------------------------------------------|
| GET    | `/reports/summary` | Conversas por status, mensagens enviadas/recebidas, tempo médio até a primeira resposta (minutos), mensagens por dia (últimos 7 dias) |

### Billing (Asaas)

Precisa de conta no [Asaas](https://www.asaas.com) (Sandbox pra testar,
produção pra valer) e as variáveis `ASAAS_API_KEY`, `ASAAS_BASE_URL` e
`ASAAS_WEBHOOK_TOKEN` no `.env`.

| Método | Rota               | Quem acessa | O que faz                                                       |
|--------|----------------------|-------------|--------------------------------------------------------------------|
| POST   | `/billing/subscribe` | Admin       | Cria cliente + assinatura no Asaas pro plano atual do tenant, devolve o link de pagamento (`invoiceUrl`) |
| GET    | `/billing/status`    | Autenticado | Status da assinatura e do tenant                                    |
| POST   | `/webhooks/asaas` | Asaas (público) | Recebe confirmação/vencimento de pagamento               |

No painel do **Asaas Sandbox**, configure o webhook em
`APP_BASE_URL/webhooks/asaas`, sem token na URL. O campo de autenticacao do
webhook deve ter exatamente o mesmo valor de `ASAAS_WEBHOOK_TOKEN` no processo
que executa a API. O Asaas envia esse segredo no header `asaas-access-token`;
ele e diferente da API Key. A query `?token=...` ainda e aceita temporariamente
quando o header esta ausente. Se houver header, ele tem precedencia. Sem segredo
configurado no backend, a chamada e rejeitada. Respostas processadas retornam HTTP 200.

Selecione `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` e `PAYMENT_OVERDUE`.
A confirmacao ativa assinatura e tenant; o vencimento suspende o tenant e bloqueia
novos logins. JWTs ja emitidos e chaves de API tambem sao bloqueados nas operacoes protegidas enquanto o tenant estiver suspenso.

### Atualizacao dos precos e configuracao do ambiente

`prisma db push` sincroniza o schema, mas nao executa este seed nem configura as
variaveis de ambiente do servidor. Planos anteriores a Fase 5 podem ter recebido
`price_cents = 0`. O seed agora atualiza Starter para **9900 centavos** e Pro para
**29900 centavos**, inclusive se ja existirem (sobrescreve precos personalizados
desses dois planos). Limites e demais planos nao sao alterados.

1. Publique a versao corrigida no servidor que executa o backend.
2. Configure nesse processo `DATABASE_URL`, `ASAAS_API_KEY`,
   `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3` e `ASAAS_WEBHOOK_TOKEN`.
   Se a API roda na Contabo e apenas o PostgreSQL fica no Render, as variaveis do
   Asaas ficam na Contabo. Reinicie o processo apos mudar seu ambiente.
3. Na raiz do projeto atualizado, com o **mesmo DATABASE_URL usado pela API**,
   execute uma vez:

   ```bash
   npm run prisma:seed
   ```

   O seed tambem cria o tenant demo se ele ainda nao existir (ver Setup local).
   Nao execute automaticamente a cada inicializacao. O `.env` da sua maquina
   nao e enviado ao Render/Contabo pelo `db push`.
4. Consulte `GET /billing/status` com JWT e confira `plan.priceCents`.
   Deve ser 9900 para Starter ou 29900 para Pro.
5. Envie `POST /billing/subscribe` com JWT de admin e `cpfCnpj` de teste aceito
   pelo Sandbox. O valor vem do plano no banco, nao do corpo da requisicao.
   Preco invalido retorna HTTP 422 antes de criar cliente no Asaas.

Se o backend esta publicado em `https://nodus-inter.onrender.com`, use
`https://nodus-inter.onrender.com/webhooks/asaas`. Se ele esta na Contabo, use
seu dominio HTTPS publico apontando para essa API.

### Testes no Sandbox

A conta Sandbox e independente da conta de producao: cadastre-se em
https://sandbox.asaas.com e gere a chave desse ambiente.

Abra a cobranca pelo `invoiceUrl` e confirme o pagamento na interface do Sandbox.
Tambem existem endpoints oficiais de simulacao, exclusivamente no Sandbox:

- `POST https://api-sandbox.asaas.com/v3/sandbox/payment/{id}/confirm`
- `POST https://api-sandbox.asaas.com/v3/sandbox/payment/{id}/overdue`

Nessas chamadas use o header `access_token` com a **API Key do Sandbox**, e
`User-Agent: NodusWhatsappSaas/1.0`. O `{id}` e o ID da **cobranca** (`pay_...`),
nao o ID da assinatura (`sub_...`). Obtenha-o no painel ou com
`GET /subscriptions/{subscriptionId}/payments` na API do Asaas. Para testar
vencimento, use uma cobranca pendente de teste separada.

Confira a entrega do webhook no painel do Asaas e os logs do servidor da API.
Apos confirmacao, `GET /billing/status` deve indicar `tenantStatus: ACTIVE` e
`subscription.status: ACTIVE`. Apos vencimento, confira `SUSPENDED` e `OVERDUE`
no banco/logs e o bloqueio de um novo login. Um POST manual no webhook testa
somente o receptor local, nao a entrega real do Asaas.

Se um segredo foi exposto, substitua-o no painel e no ambiente do backend.
Nao versione `.env` nem coloque tokens em URLs. O log de requisicoes registra
apenas o caminho, sem query string.

Referencias oficiais:
- https://docs.asaas.com/docs/sandbox
- https://docs.asaas.com/docs/sobre-os-webhooks
- https://docs.asaas.com/reference/confirmar-pagamento
- https://docs.asaas.com/reference/forcar-vencimento

## Isolamento multi-tenant

O `tenantId` vem embutido no JWT (`sub`, `tenantId`, `role`, `email`) — ou,
na API pública, resolvido a partir da chave de API — e chega em todo
controller via `@CurrentUser()` ou `@CurrentApiTenant()`. Toda query nos
services já nasce filtrada por esse `tenantId` — não existe endpoint que
devolva dado de outro tenant. `Conversation` não guarda `tenantId` direto:
ele é sempre resolvido via `channel.tenantId`, pra não duplicar a coluna.

## Roadmap

Todas as 5 fases do plano original estão implementadas: fundação
multi-tenant, conectores de canal, inbox/atendimento, API aberta, e
billing/automação/relatórios. Próximos passos ficam a critério de uso real
em produção — coisas como paginação nas listagens, testes e2e com banco de
verdade, e evolucao da experiencia de regularizacao de cobrancas.


### Suspensao de sessoes existentes

Todas as rotas com `JwtAuthGuard` consultam o status atual do tenant no banco
apos validar o JWT. Operacoes protegidas retornam HTTP 403 com
`code: TENANT_SUSPENDED` durante a suspensao. Chaves de API seguem a mesma regra,
sem cache de status. Um JWT valido volta a funcionar na proxima chamada apos
reativacao; tokens expirados continuam exigindo novo login.

A unica excecao JWT e `GET /billing/status`, que permanece acessivel a uma
sessao valida durante a suspensao para consultar a pendencia. Ela nao permite
acesso anonimo. O link de pagamento ja emitido pelo Asaas continua sendo usado
para regularizacao; este ajuste nao adiciona tela ou endpoint para recuperar
esse link. Novos logins de tenants suspensos continuam bloqueados.

Webhooks de entrada mantem suas regras de autenticacao e processamento,
inclusive o Asaas, para receber a confirmacao e reativar o tenant. Este bloqueio
se aplica as chamadas autenticadas por JWT/API key; nao interrompe trabalhos
ja iniciados nem desliga conectores ou respostas automaticas de webhooks.

Teste no Postman apos o deploy:
1. Guarde um JWT de tenant ativo e confirme `GET /conversations` com HTTP 200.
2. Simule `PAYMENT_OVERDUE` para sua assinatura Sandbox.
3. Com o MESMO JWT, confirme HTTP 403 em `/conversations` e HTTP 200 com status
   suspenso em `/billing/status`. Um novo login tambem deve continuar bloqueado.
4. Reative com pagamento Sandbox (ou `PAYMENT_CONFIRMED` no teste manual).
5. Com o mesmo JWT ainda valido, confirme que `/conversations` volta a responder.
6. Repita o bloqueio com uma chave existente em `/public/v1/conversations`.

Nao ha alteracao de schema ou seed nesta melhoria. Basta publicar o codigo.
