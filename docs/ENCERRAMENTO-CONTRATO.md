# Encerramento de contrato

Implementação para encerrar imediatamente a assinatura da própria empresa, sem excluir histórico local. Exclusiva de ADMIN com senha atual. Não existe acesso global entre empresas nem encerramento sem assinatura local.

## Postman

POST `https://nodus-inter.onrender.com/billing/cancel`

Headers: `Authorization: Bearer {{jwt}}` e `Content-Type: application/json`.

```json
{
  "currentPassword": "SENHA_DO_ADMIN_LOGADO",
  "confirmation": "CANCEL"
}
```

Resposta de sucesso (POST retorna 201 por padrão):

```json
{
  "tenantStatus": "SUSPENDED",
  "subscriptionStatus": "CANCELED",
  "cancellationPending": false,
  "existingPaymentsPreserved": true,
  "historyPreserved": true
}
```

O encerramento é imediato, não ao final do período pago. Não gera estorno. Cobranças existentes, inclusive vencidas, permanecem no Asaas. A Nodus não permite reativação desse contrato por pagamento ou novo POST /billing/subscribe.

## O que acontece

1. Confere ADMIN, senha atual e confirmação literal CANCEL, sempre no tenant do JWT.
2. Em transação, bloqueia tenant e assinatura, registra CANCELED e cancellationPending=true, suspende acesso e cancela campanhas/entregas QUEUED.
3. Envia PUT à assinatura Asaas com status INACTIVE. Não usa DELETE: a remoção pode excluir cobranças pendentes/vencidas.
4. Só marca cancellationPending=false depois de resposta válida confirmando INACTIVE.

GET /billing/status passa a incluir canceledAt e cancellationPending. O administrador ainda pode entrar para consultar cobranças/status e repetir o cancelamento, usando as exceções de acesso já existentes. Usuários e API keys ficam bloqueados nas rotas operacionais. As chaves não são apagadas.

Se receber 503 com code CANCELLATION_PENDING, o acesso local já está bloqueado, mas a interrupção da recorrência externa ainda não foi confirmada. Repita o mesmo POST autenticado depois de corrigir a indisponibilidade. Não há retry automático. Um timeout ou erro de banco após a resposta remota também exige consultar status e repetir; não considerar cancelamento financeiro concluído enquanto a pendência estiver true. A operação INACTIVE é repetível, e a transição final/auditoria usa update condicional.

Webhooks financeiros relêem a assinatura sob os mesmos locks antes de reconciliar. CANCELED nunca volta a ACTIVE por pagamento tardio. A confirmação de dívida antiga não é reativação contratual.

## Limites e preservação

- Não exclui usuários, conversas, contatos, canais ou cobranças.
- Não desconecta o aparelho, não exclui instância Evolution e não revoga a conexão Meta. Recepção/histórico dos provedores podem continuar; automações existentes respeitam tenant não ACTIVE.
- Mensagens ou requisições que já estavam em execução não podem ser recolhidas. Apenas a fila QUEUED é cancelada; confira SENDING/UNKNOWN no provedor.
- Retenção de dados configurada no sistema continua valendo; preservação aqui significa que o cancelamento não apaga histórico.
- Sem assinatura local, retorna 404 e não suspende o tenant. Não substitui ferramenta global de administração de empresas.
- Uma reativação manual no painel Asaas pode voltar a gerar cobranças; esse endpoint não monitora alterações manuais posteriores.
- O script privacy:erase-tenant é diferente: continua sendo exclusão definitiva.

## Deploy

Inclui migration aditiva `20261014160000_contract_cancellation`: colunas cancellation_pending e canceled_at em subscriptions. Não precisa seed ou db push. O comando de inicialização `npx prisma migrate deploy && npm run start:prod` aplica a migration antes de iniciar o backend. Gere Prisma Client/build no deploy normal. Não altera frontend nem acrescenta botão.

## Validação em homologação

1. Usar empresa/assinatura de teste e conferir GET /auth/me e GET /billing/status.
2. Senha incorreta deve retornar 403 sem alterar estado; AGENT não tem permissão.
3. Enviar o POST correto e consultar status: SUSPENDED/CANCELED, cancellationPending=false.
4. Conferir INACTIVE no Asaas e verificar que cobranças anteriores continuam disponíveis.
5. Conferir que JWT existente e API key não acessam rotas operacionais.
6. Confirmar que novo evento financeiro da assinatura não reativa o tenant.
7. Repetir cancelamento deve retornar sucesso sem nova transição.

Testes locais cobrem falha remota/retry, senha/papel, isolamento por tenant, idempotência, payload INACTIVE, autorização do controller e webhook com snapshot anterior ao lock. Não foi executado cancelamento em conta real ou Sandbox para publicar este código.

Referência do provedor: https://docs.asaas.com/reference/atualizar-assinatura-existente
