# Seguranca e privacidade — implantacao assistida

Esta versao altera autenticacao, banco, webhooks e contratos de resposta. Nao
integrar com deploy automatico antes de preparar o ambiente. Nao e certificacao
LGPD nem substitui a validacao dos responsaveis juridico e de infraestrutura.

## Preparacao e sequencia (banco existente criado por db push)

1. Desabilitar deploy automatico temporariamente. Validar primeiro numa copia
   de homologacao. Fazer backup e TESTAR restauracao; guardar tambem a chave de
   criptografia, separadamente e com acesso restrito.
2. Configurar JWT_SECRET aleatorio com >=32 caracteres; DATA_ENCRYPTION_KEY com
   64 caracteres hexadecimais (32 bytes), independente do JWT; META_APP_SECRET
   (App Secret do app Meta, nao o verify token), META_VERIFY_TOKEN,
   EVOLUTION_WEBHOOK_TOKEN e ASAAS_WEBHOOK_TOKEN. Nao colar segredos no Git/chat.
   Gerar a chave localmente: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Segredos sao exigidos mesmo antes de conectar esses provedores nesta versao.
3. CORS_ORIGINS: lista separada por virgulas de ORIGENS HTTPS exatas do frontend,
   sem barra final. Postman nao depende de CORS. TRUSTED_PROXY_CIDRS: somente
   IPs/CIDRs confirmados da cadeia de proxies. Nao usar `true`, `0.0.0.0/0` ou
   confiar cegamente no primeiro X-Forwarded-For. Validar dois IPs distintos no
   ambiente real; sem isso, o rate limit pode agrupar clientes no IP do proxy.
4. Pausar operacoes e entregas dos provedores durante a migracao. Na copia do
   projeto atualizado: `npm ci --include=dev` e `npx prisma generate`.
5. Comparar o schema real com a baseline ANTES de marca-la como aplicada.
   Banco que ja possui as tabelas da fase 5: executar UMA vez
   `npx prisma migrate resolve --applied 20260925000000_baseline` apenas se ele
   corresponde a baseline. Banco vazio: nao executar resolve.
   Depois: `npx prisma migrate deploy`. Nao utilizar db push/--accept-data-loss.
   A migration adiciona lock de login, versao de sessao, retencao legal e tabelas
   de rate limit/auditoria/eventos. O indice unico de canais falha se houver
   duplicatas de tipo/externalId: revisar e resolver manualmente, sem apagar
   dados arbitrariamente. Nenhum seed e necessario.
6. Com o MESMO DATABASE_URL e DATA_ENCRYPTION_KEY da API, executar
   `npm run security:encrypt`. Reexecutavel: converte legados e verifica os
   criptografados. Em caso de falha, corrigir e repetir antes de servir trafego.
   Nao ha fallback para ler segredo em texto puro. Rotacao futura exige
   descriptografar com a chave anterior e recriptografar com a nova, em manutencao.
7. Configurar TODAS as instancias Evolution existentes para enviar
   `x-evolution-token: <EVOLUTION_WEBHOOK_TOKEN>`. Instancias novas usam o campo
   `webhook.headers`. Confirmar suporte desse campo na versao instalada; se nao
   houver, atualizar o provedor ou usar um proxy autenticado — nao desativar a
   verificacao. Meta precisa enviar X-Hub-Signature-256 gerado pelo App Secret.
   Asaas usa somente asaas-access-token; query `?token=` foi removida.
8. Render Build: `npm ci --include=dev && npx prisma generate && npm run build`.
   Start: `npx prisma migrate deploy && npm run start:prod`.
   Node: validar em 20.20.2 ou superior. Nao versionar node_modules/dist.
9. Publicar, fazer novo login (JWTs antigos sem versao/issuer/audience sao
   rejeitados), executar testes abaixo e reativar entregas/deploy automatico.
   Se falhar, manter em manutencao. Nao voltar ao codigo antigo com tokens
   criptografados: ele nao sabe le-los. Rollback exige backup compativel e plano
   para nao perder mensagens/cobrancas ocorridas depois do backup.

## Controles implementados

- JWT HS256 com issuer/audience, expiracao de 1h, segredo obrigatorio; leitura do
  usuario/role atual e tokenVersion. Trocar senha ou POST /auth/logout-all revoga
  sessoes. Remocao do usuario invalida JWT. Troca obrigatoria de senha e aplicada
  no backend; somente change-password/logout-all escapam dessa restricao.
- Cinco falhas de senha bloqueiam conta por 15 minutos. Incremento/lock atomicamente
  no PostgreSQL. Senhas novas >=12 caracteres e <=72 bytes UTF-8; bcryptjs custo12.
  Hashes bcrypt anteriores continuam validos. Conta inexistente usa comparacao
  dummy. Sem MFA da aplicacao nesta versao; exigir MFA em GitHub/Render/Contabo/Asaas.
- AES-256-GCM com nonce aleatorio e contexto autenticado para Meta e segredos de
  webhooks de saida. Chaves ficam fora do banco; perda da chave perde acesso aos
  segredos. Criptografia de disco do provedor nao substitui essa camada.
- Meta: assinatura sobre corpo ORIGINAL; Evolution: token; Asaas: token no header.
  Status Meta restrito ao canal; identificador do canal unico por tipo; cadastro
  Meta verifica acesso ao numero com a API do provedor.
- Asaas: processamento serializado por assinatura, transacao local e deduplicacao
  por ID do evento; consulta cobrancas OVERDUE/CONFIRMED/RECEIVED no provedor.
  Evento antigo nao define estado sozinho. Cobertura: fluxo atual de pagamentos;
  cancelamentos/estornos exigem politica comercial adicional antes de habilita-los.
- Mensagens de entrada: deduplicacao por externalId/canal em transacao com lock
  do canal. Dispatch externo depois do commit; entrega externa ainda e best-effort,
  sem garantia de fila persistente. Ausencia de ID externo impede deduplicacao.
- HTTPS publico em webhooks de saida, bloqueio IPv4/IPv6 privado/reservado,
  DNS fixado por entrega, sem redirects, timeout. Conectores fixos tem timeout.
- Helmet, CORS restrito, Cache-Control no-store, corpos JSON <=256KB,
  strings limitadas, listagens de conversas/mensagens ate100, cursor por ID.
  Respostas nao incluem config/segredos de canais; mensagem raw nova nao e guardada.
- Logs nao guardam corpo de conversa/payload completo/query string.
  Auditoria registra acao, actorId e tenantId sem mensagem, senha ou token.

## Limites iniciais (ajustar por metricas de uso)

Contadores em PostgreSQL, compartilhados entre processos e preservados em restart.
Janela fixa: pode haver burst de ate duas janelas junto da fronteira; nao e WAF.

| Escopo | Limite |
|---|---|
| Login por IP | 10/minuto |
| Login por email normalizado (HMAC no banco) | 10/15min |
| Cadastro por IP | 5/hora |
| Demais chamadas por IP (agregado) | 300/minuto |
| Webhooks por IP (grupo separado) | 600/minuto |
| Operacoes autenticadas por tenant | 600/minuto |
| Operacoes JWT por usuario | 120/minuto |
| Exclusao via privacy por usuario | 5/hora |

429 informa retryAfter em segundos. Banco indisponivel falha fechado. Proteger
borda contra ataques volumetricos; uma consulta por requisicao nao substitui WAF.
Agendar `npm run security:cleanup` pelo menos de hora em hora para remover contadores expirados e limitar crescimento.
As rotas privacy de administrador e billing/status aceitam tenant suspenso com
JWT valido. Login novo de inadimplente permanece bloqueado; solicitacoes LGPD
podem ser recebidas por canal externo e executadas pelo operador.

## Direitos e retencao

- GET /privacy/contacts/:id?cursor=...: admin, exportacao paginada de contato e
  mensagens do proprio tenant; nextCursor nulo encerra a exportacao.
- DELETE /privacy/contacts/:id: admin, body
  `{ "currentPassword": "...", "confirmation": "ERASE" }`. Apaga contato,
  conversas e mensagens locais atomicamente. Contact.legalHold impede apagar
  dado sob retencao legal (409). Campo administrado por operador autorizado,
  com registro da justificativa fora do payload. Validar identidade e base legal
  do solicitante ANTES de executar. Nova mensagem pode recriar o contato.
- DELETE /privacy/users/:id: outro admin do mesmo tenant, mesmo body. Remove
  conta, desatribui conversas e remove actorId de auditorias anteriores. Nao apaga
  automaticamente conversas da empresa nem dados financeiros.
- `npm run privacy:erase-tenant`: dry-run por padrao com ERASE_TENANT_ID; exige
  CONFIRM_TENANT_ERASURE igual ao ID para executar. Operador confirma legitimidade,
  resolve retencoes e pausa entrada externa primeiro. Suspende tenant, cancela
  assinatura Asaas e remove instancias Evolution antes da exclusao local. Falha
  externa interrompe exclusao. Meta deve ser desconectada no provedor; conta e
  registros fiscais do Asaas nao sao apagados automaticamente.
- `npm run privacy:retention`: dry-run; MESSAGE_RETENTION_DAYS e
  AUDIT_RETENTION_DAYS sao obrigatorios, sem prazo arbitrario. APPLY_RETENTION=true
  executa exclusao de mensagens fora do prazo, respeitando contact.legalHold,
  limpa raw legado e remove contadores/eventos antigos. Definir agenda e revisar
  preservacao legal tambem para auditorias ANTES de ativar. Job nao foi executado
  no banco real. Revisar backups antes: copia antiga pode conter raw/tokens claros.
- Registrar exclusoes em processo restrito independente do backup. Ao restaurar,
  reaplicar exclusoes antes de liberar acesso. Provedores, destinatarios de
  webhooks e backups exigem tratamento separado; nenhuma API promete apagar
  automaticamente todas as copias externas.

## Teste de aceite

1. Segredo JWT/chave ausente: startup deve falhar. Origem nao permitida nao recebe
   permissao CORS; payload grande recebe413. Confirmar cabecalhos Helmet.
2. Fazer 5 logins com senha errada em homologacao; senha correta deve falhar
   enquanto locked_until estiver no futuro; apos prazo, permitir autenticacao.
3. Com JWT valido, suspender tenant: operacoes403, billing/status200. Reativar:
   mesmo JWT volta a funcionar. Trocar senha: JWT anterior401.
4. Repetir requisicoes ate429 e testar dois IPs reais diferentes atras do proxy.
5. Meta sem assinatura/com corpo alterado401; assinatura valida aceita. Evolution
   sem segredo401; Asaas com query antiga401. Configurar provedores antes disso.
6. Simular vencimento/pagamento pelo endpoint SANDBOX oficial do Asaas: agora um
   POST manual com PAYMENT_OVERDUE nao suspende se o provedor nao tem pendencia.
7. Exportacao/exclusao: tenant errado404, agente403, senha incorreta403,
   legalHold409; exclusao autorizada remove registros e nao o tenant vizinho.
8. Testar DNS/redirects privados e revisar que respostas/logs nao trazem segredos.
9. Restaurar backup numa base isolada, aplicar exclusoes e validar chaves.

## Pendencias operacionais LGPD/infraestrutura (nao automatizadas)

Inventario de dados/finalidades/bases legais; papeis controlador/operador; contrato
com clientes/suboperadores; aviso de privacidade e canal do titular; avaliacao
especifica de dados de saude; transferencia internacional (incluindo Oregon);
responsavel/encarregado conforme enquadramento; prazos aprovados de retencao;
procedimento de incidentes e comunicacao nos prazos aplicaveis; treinamento;
controle de acesso a logs/backups; MFA, firewall/SSH, patching e testes de restore.
Frontend deve renderizar mensagens como texto, evitar HTML nao confiavel e
proteger armazenamento de sessao; nenhum frontend foi auditado neste repositorio.
Nao ha comprovacao dessas medidas por existir este documento.

Fontes para revisao pelo responsavel:
- https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
- https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados

## Verificacao desta alteracao (2026-09-26)

- Node 20.20.2: build TypeScript e 12 suites / 85 testes aprovados.
- HTTP real em processo: Helmet, CORS, corpo bruto, limite 413, protecao contra
  X-Forwarded-For forjado; resolucao de dependencias de todos os modulos.
- Prisma validate aprovado. Baseline e upgrade executados em PostgreSQL embutido
  PGlite, com preservacao de registro e teste do SQL de bloqueio de login.
- `npm audit --omit=dev`: zero vulnerabilidades reportadas na verificacao.
  Isso nao comprova ausencia de falhas no software nem inclui dependencias dev.
- Nao executados no ambiente publicado: restore, migracao, criptografia,
  exclusoes, teste dos IPs reais atras do proxy ou integracao dos provedores.
