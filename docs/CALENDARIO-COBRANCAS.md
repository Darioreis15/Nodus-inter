# Calendário Nodus: geração dia 1, vencimento dia 10

## Resultado e limites
O backend passa a controlar a emissão mensal no Asaas, no fuso America/Sao_Paulo. Não depende de manter o painel aberto. A assinatura nativa do Asaas gera cobranças antecipadamente (40, 14 ou 7 dias), por isso não atende à antecedência exata de 9 dias.

A ativação é global: BILLING_CALENDAR_ENABLED=true. Contratos locais ACTIVE em empresas ACTIVE migram automaticamente no próximo processamento. Contratos novos via POST /billing/subscribe já entram no novo calendário. Contratos legados PENDING ou OVERDUE só migram quando voltarem a ACTIVE; até lá preservam a recorrência anterior. Empresas sem assinatura/cliente Asaas precisam concluir o cadastro de cobrança com CPF/CNPJ; apenas existir uma empresa ACTIVE não fornece os dados necessários para cobrar.

Novos contratos: cadastro no dia 1 entra nesse mês; após dia 1, começa no mês seguinte. Não há cobrança imediata nem proporcional. POST /billing/subscribe retorna scheduled, firstIssueDate e firstDueDate, com invoiceUrl=null até a emissão. O acesso inicial segue as regras existentes de cadastro da Nodus; esta atualização não exige pagamento antecipado para entrar. Exemplo: contrato em 14/10 tem primeira emissão em 01/11 e vencimento em 10/11.

Migração: confirma a interrupção da recorrência nativa (INACTIVE), preserva cobranças já emitidas e inicia após o último mês já cobrado. Exemplo: existe cobrança com vencimento em 25/11; ela fica intacta e a nova regra começa em 01/12, vencendo 10/12. Não altera datas de cobranças anteriores nem cobra novamente o mesmo mês. O critério conservador considera o mês do vencimento como competência; não recalcula proporcionalidade. Confira contratos com períodos especiais.

O valor dos contratos existentes vem da assinatura Asaas, e não do preço de catálogo ou do plano de acesso. Multa, juros, desconto e tipo de pagamento simples são preservados na configuração. Contratos com cartão recorrente, split, prazo final, limite de parcelas ou periodicidade diferente de mensal ficam em revisão, mantendo a recorrência anterior. Não é possível converter débitos automáticos de cartão em cobranças avulsas sem mudar o meio de pagamento/consentimento.

## Publicação e ativação
1. Integre o PR e publique o backend com o comando de início existente: npx prisma migrate deploy && npm run start:prod. A migração cria billing_cycles e campos adicionais; não apaga registros.
2. Inicialmente deixe BILLING_CALENDAR_ENABLED=false enquanto configura o agendador. Não executar seed/db push.
3. Gere um segredo aleatório (64 caracteres hex, por exemplo) e coloque como BILLING_RUN_TOKEN no Render e no servidor agendador. Nunca publicar o segredo no Git, frontend ou URL. O segredo autoriza somente o processamento do calendário.
4. Atualize a pasta owner na raiz do subdomínio app, preservando a pasta. O index do painel deve continuar em owner/index.html. O painel exibe calendário ativo/desativado, contratos migrados, migrações pendentes, emissões a conciliar e início por empresa.
5. Configure o agendador Contabo abaixo e teste uma execução. Com calendário desativado, ele retorna aviso de desativado; isso é esperado.
6. Em homologação, altere BILLING_CALENDAR_ENABLED=true no Render e faça restart/deploy. Isso autoriza a migração dos contratos elegíveis; não precisa alterar cada empresa. Não edite manualmente a recorrência Asaas após migrar.
7. Execute o agendador uma vez e consulte o painel /owner/. Verifique também no Sandbox que as assinaturas migradas estão INACTIVE e que as cobranças antigas continuam lá. Uma empresa migrada continua com contrato local ACTIVE; INACTIVE no Asaas significa apenas que a geração passou para a Nodus.
8. Valide uma emissão com os testes automatizados e, na próxima data programada, uma cobrança real de Sandbox. Não altere relógio do servidor ou datas de produção para simular.

## Agendador externo na Contabo
O processamento interno roda a cada 15 minutos enquanto o backend estiver acordado. Um Render gratuito pode dormir; o agendador externo é necessário para não depender de acessos de clientes. Se houver falha externa, não existe garantia de minuto exato. Recomenda-se plano/backend sempre ativo quando entrar em operação comercial.

Requisitos: Node.js >=20 no host que rodará o script, cron e acesso HTTPS ao backend. Confira `node --version` e `command -v node`. Se a Contabo não tiver Node no host, use um agendador HTTPS ou configure um worker Node; o container da Evolution não é o local deste arquivo.

No servidor Contabo, crie /opt/nodus-billing e coloque ali o arquivo run-billing-calendar.cjs incluído no pacote. Crie /opt/nodus-billing/calendar.env com:

NODUS_API_URL=https://nodus-inter.onrender.com
BILLING_RUN_TOKEN=COLE_O_MESMO_SEGREDO_DO_RENDER

Proteja o arquivo: chmod 600 /opt/nodus-billing/calendar.env

Crie /opt/nodus-billing/run.sh com:

#!/bin/sh
set -a
. /opt/nodus-billing/calendar.env
set +a
exec /usr/bin/node /opt/nodus-billing/run-billing-calendar.cjs

Use no exec o caminho retornado por `command -v node` (pode ser diferente de /usr/bin/node).
Depois: chmod 700 /opt/nodus-billing/run.sh
Teste: /opt/nodus-billing/run.sh

Em `crontab -e`, adicione sem remover outras linhas:

5 * * * * /opt/nodus-billing/run.sh >> /opt/nodus-billing/calendar.log 2>&1

Executa uma vez por hora, inclusive dia 1. O fuso do cron não decide a competência: o backend usa São Paulo. Rotacione o arquivo de log conforme a política do servidor. Não coloque o token na linha do cron.

## Falhas, cancelamento e revisão
- Há um registro único por contrato e mês. Processamentos concorrentes reservam a tentativa antes do POST externo.
- externalReference no Asaas NÃO é garantia de idempotência. Após timeout, a Nodus apenas consulta a referência; não repete cegamente a criação. Se achar a cobrança exata, recupera o vínculo. Se não achar, exibe revisão e não gera outra automaticamente. Pode faltar uma cobrança em vez de haver cobrança duplicada.
- Uma emissão atrasada por indisponibilidade pode ocorrer até dia 10, mantendo vencimento no dia 10. Após esse dia, não é criada automaticamente já vencida: MISSED_CYCLE exige revisão. Meses anteriores não são cobrados retroativamente pelo worker.
- BILLING_REVIEW_REQUIRED: conferir o contrato no Asaas e os registros do calendário; não reativar a assinatura nativa nem criar cobrança manual sem conferir os IDs.
- Para uma tentativa SENDING sem cobrança encontrada, confira a externalReference nodus:ID_DA_ASSINATURA_LOCAL:AAAA-MM no Asaas e aguarde a conclusão de qualquer chamada em andamento. Esta versão não tem botão para reenviar uma tentativa incerta. Requer intervenção técnica após conciliação; não limpe billing_cycles para forçar envio.
- Cancelamento local continua CANCELED, impede emissões e bloqueia acesso; cobranças antigas continuam preservadas. Webhooks de pagamentos antigos não reabrem contrato encerrado.
- A emissão automática não é débito automático em conta. O cliente paga pelo link/formas habilitadas no Asaas. Notificações de e-mail/SMS/WhatsApp seguem a configuração da conta Asaas; este PR não manda mensagens adicionais.
- Atrasos em cobranças antigas também entram na conciliação financeira dos contratos migrados.
- Não desfaça a migração SQL para rollback. BILLING_CALENDAR_ENABLED=false pausa novas emissões, mas NÃO reativa a recorrência Asaas. Reativá-la sem conciliar pode duplicar cobranças. Os webhooks continuam funcionando para pagamentos existentes.

## Rotas
GET /owner/billing-calendar — JWT exclusivo do proprietário.
POST /billing/calendar/run — header x-billing-run-token, segredo de servidor; sem JWT de cliente.
GET /billing/status — inclui calendar com dias, início e valor contratual.

## Validação automatizada
46 testes de calendário, proprietário e cobrança; build; migração completa em PostgreSQL embarcado preservando dados e impondo unicidade mensal. Testes de provedor são simulados, nenhuma cobrança real foi criada. A validação Sandbox integrada continua necessária.

Fontes oficiais consultadas:
https://docs.asaas.com/docs/faq-assinaturas
https://docs.asaas.com/reference/criar-nova-cobranca
https://docs.asaas.com/reference/listar-cobrancas
