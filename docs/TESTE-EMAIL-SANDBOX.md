# Teste de cobrança por e-mail no Owner

## Publicação

1. Faça o merge e o deploy do backend. O start deve executar `npx prisma migrate deploy`; a migration `20261020020000_sandbox_billing` preserva as cobranças existentes. Não execute seed ou db push.
2. No Render, mantenha as credenciais de homologação do Asaas e configure:

```dotenv
ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
BILLING_SANDBOX_TEST_ENABLED=true
BILLING_DELIVERY_ENABLED=true
```

`RESEND_API_KEY` e `MAIL_FROM` devem estar configurados com o remetente verificado. O e-mail enviado é real, mesmo com cobrança Sandbox.

3. Na Hostinger, atualize `owner/index.html`, `owner/owner.js` e `owner/owner.css` dentro da pasta **owner** do app. Preserve a estrutura e não substitua a página principal do aplicativo.

## Executar

1. Entre em `https://app.nodusintegracao.com/owner/` com a conta do proprietário.
2. Localize a empresa de teste e abra **Avisos de cobrança**.
3. Ative **Enviar por e-mail**, informe um endereço sob seu controle, confirme a gestão de avisos e salve. Essa configuração desabilita os avisos nativos Asaas para esse cliente, como no fluxo normal.
4. Na seção **Teste de cobrança por e-mail**, confira o endereço salvo.
5. Preencha novamente sua senha de proprietário e clique em **Gerar / consultar teste de e-mail**. Confirme o envio.
6. Será criada uma cobrança BOLETO de **R$ 5,00 no Sandbox**, com vencimento em três dias. O aviso usa o fluxo Resend da Nodus, com assunto `[TESTE SANDBOX]` e link da fatura. Não há anexo PDF neste aviso.
7. Confira a caixa de entrada e o spam. Use **Atualizar histórico** para acompanhar. `SENT` significa aceito pelo provedor; valide a chegada no destinatário.

## Repetições e isolamento

- Uma cobrança de teste por empresa e data de Brasília. Repetições recuperam a cobrança e o aviso existentes; não reenviam e-mail já aceito.
- Se o Asaas não confirmar a criação, a reserva fica persistida. Nova tentativa apenas consulta a referência; nunca repete automaticamente o POST de criação. Um teste incerto anterior impede um novo teste.
- Se não houver exatamente uma cobrança correspondente, confira o Sandbox antes de prosseguir. Não altere registros no banco para forçar reenvio.
- Falha incerta de e-mail usa a revisão existente. Só autorize nova tentativa após verificar no provedor que não houve envio.
- O teste envia apenas e-mail, mesmo com WhatsApp habilitado no contrato.
- Cobranças de teste não alteram situação do contrato, calendário, valor mensal nem cobranças já pagas. Pagamento ou vencimento de um teste não ativa/suspende a empresa.
- A função exige proprietário, senha, confirmação e o mesmo e-mail salvo. Administradores de clientes não têm acesso.
- Com URL Asaas de produção, a emissão é bloqueada no backend e o botão fica oculto. Avisos de teste pendentes também são bloqueados fora do Sandbox.
- Após homologar, defina `BILLING_SANDBOX_TEST_ENABLED=false`.

## Postman (opcional)

Consulte `GET /owner/tenants/:id/delivery` com JWT do proprietário para obter `sandboxTest.date` e o e-mail salvo. Em seguida:

```http
POST /owner/tenants/:id/sandbox-billing
Authorization: Bearer JWT_DO_PROPRIETARIO
Content-Type: application/json
```

```json
{
  "currentPassword": "SUA_SENHA",
  "confirmation": "SANDBOX_EMAIL",
  "date": "DATA_RETORNADA_EM_SANDBOXTEST",
  "expectedEmail": "EMAIL_FINANCEIRO_SALVO"
}
```

Resposta: `test`, `cycleId`, `paymentId`, `invoiceUrl`, `valueCents`, `dueDate`, `emailState` e `error`. Um HTTP de sucesso não confirma entrega à caixa de entrada.

A rota regular `/billing/calendar/run` mantém o calendário normal e não força emissão fora de data. O teste acima não depende de antecipar esse calendário.
