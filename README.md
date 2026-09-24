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
| POST   | `/webhooks/asaas?token=...` | Asaas (público) | Recebe confirmação/vencimento de pagamento               |

No painel do Asaas, configure o webhook apontando pra
`APP_BASE_URL/webhooks/asaas?token=SEU_ASAAS_WEBHOOK_TOKEN` — esse `token` é
uma verificação simples por query string, já que o Asaas não assina o corpo
por padrão. Quando um pagamento vence (`PAYMENT_OVERDUE`), o tenant é
suspenso automaticamente (`Tenant.status = SUSPENDED`) e o login passa a ser
bloqueado até o pagamento ser confirmado de novo.

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
verdade, e enforcement mais fino do `TenantStatus` em outras rotas (hoje só
o login checa).
