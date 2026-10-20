# Cobranças automáticas e anexos pela API

## Dois fluxos independentes

1. **Mensalidade Nodus → empresa cliente:** o calendário existente emite no dia 1, vencimento dia 10. O novo worker consulta o pagamento no Asaas e envia o link seguro da fatura por Resend e/ou pelo canal WhatsApp da própria Nodus, conforme configuração no Owner. O cliente abre o link e acessa o boleto disponível. Não há PDF anexado automaticamente nesse fluxo. A opção Boleto vale para próximas emissões; não transforma cobranças já emitidas.
2. **ERP da empresa → cliente dela:** o ERP gera seu boleto e envia o arquivo PDF para a rota pública Nodus, usando a chave API dessa empresa. A Nodus encaminha pelo canal da empresa. Não precisa acessar o Asaas da Nodus e não recebe autorização para consultar contratos de outras empresas.

O arquivo ou link do boleto não dispara uma mensagem sozinho: o backend automatiza esse envio. Usar o canal Nodus evita contratar o aviso WhatsApp do Asaas para este fluxo, mas não elimina custos de e-mail, infraestrutura, WhatsApp/Meta ou tarifas do boleto. Consulte os preços dos provedores.

## Publicar backend

1. Faça merge do PR e aguarde o deploy. Build: `npm ci --include=dev && npx prisma generate && npm run build`. Start: `npx prisma migrate deploy && npm run start:prod`.
2. A migration `20261020000000_billing_delivery` preserva os contratos e inicia o envio **desativado**. Não precisa de `db push` ou seed.
3. Confirme no Render as variáveis já existentes `PLATFORM_OWNER_USER_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `ASAAS_API_KEY`, `ASAAS_BASE_URL` e `BILLING_RUN_TOKEN`. Nunca coloque esses segredos no frontend.
4. Mantenha `BILLING_CALENDAR_ENABLED=true` após validar o calendário e acrescente `BILLING_DELIVERY_ENABLED=true`. Faça redeploy.
5. O agendador Contabo existente que chama `POST /billing/calendar/run`, com `x-billing-run-token`, agora executa emissão e avisos. Reutilize-o; não crie um segundo agendador de emissão. Com a aplicação ativa há também processamento interno de avisos a cada minuto. Em hospedagem que suspende o processo, o acionamento externo é necessário. Mantenha chamadas periódicas, por exemplo a cada 5 minutos, conforme o guia do calendário.
6. Se usar Meta, configure `BILLING_WHATSAPP_TEMPLATE_NAME` e `BILLING_WHATSAPP_TEMPLATE_LANGUAGE=pt_BR`. Se usar Evolution, não precisa dessas duas variáveis.

## Publicar painel na Hostinger

O ZIP contém a pasta **owner/**. Envie essa pasta para a raiz de `app.nodusintegracao.com`, preservando a estrutura:

```
raiz-do-app/
  index.html        (aplicativo existente, não sobrescrever com Owner)
  owner/
    index.html
    owner.js
    owner.css
```

Não coloque os três arquivos de owner diretamente na raiz. Abra `https://app.nodusintegracao.com/owner/`, recarregue com Ctrl+F5 e entre com o proprietário autorizado.

## Configurar uma vez por contrato

1. Em Empresas, abra **Avisos de cobrança**.
2. Escolha Boleto para as próximas emissões, se esse for o método desejado.
3. Marque e-mail e informe o e-mail financeiro do destinatário.
4. Marque WhatsApp, informe celular com DDI (ex.: `5531988887777`) e selecione o **canal remetente da Nodus**. O canal deve estar conectado. Não é o canal pertencente ao cliente.
5. Leia a confirmação, preencha sua senha e salve.
6. Ao ativar qualquer envio, o backend desabilita **todos os avisos nativos do Asaas para aquele cliente** usando `notificationDisabled=true`. Isso inclui lembretes de vencimento, confirmação e avisos de outras cobranças do mesmo cadastro. A nova rotina envia apenas o aviso da mensalidade emitida, uma vez por meio. Desativar os envios Nodus não reativa avisos Asaas automaticamente. Se quiser voltar ao modo Asaas, configure-o no painel do Asaas após desativar os envios Nodus.
7. Nas próximas mensalidades, emissão e aviso serão automáticos. É preciso configurar cada contrato novo uma vez; não deduzimos celular financeiro ou canal sem confirmação.

Ao ativar, **nenhuma cobrança histórica é disparada**. É necessário que o contrato esteja no calendário Nodus; o fluxo não envia automaticamente cobranças avulsas criadas diretamente no painel Asaas. Cobranças pagas, removidas, de contrato encerrado ou com dados divergentes não são enviadas.

### Modelo Meta

Crie um template de utilidade aprovado, com **quatro parâmetros de texto no corpo**, nesta ordem:

```
Olá, {{1}}! Sua mensalidade Nodus de {{2}} vence em {{3}}.
Acesse sua cobrança: {{4}}
Se já efetuou o pagamento, aguarde a compensação.
```

Exemplos dos parâmetros: Empresa Exemplo; R$ 99,00; 10/11/2026; link HTTPS Asaas.
O nome e idioma configurados devem corresponder ao modelo aprovado. Esta versão não preenche parâmetros de botão ou cabeçalho do template. O envio Meta usa sempre esse template, inclusive fora da janela de atendimento. A configuração de um modelo não remove restrições de conta impostas pela Meta.

### Histórico e falhas

- Na fila: aguardando processamento.
- Aguardando nova tentativa: configuração ou consulta falhou **antes** de chamar o provedor. Reavalia após 15 minutos.
- Aceito pelo provedor: a solicitação foi aceita, **não é confirmação de entrega ou leitura**. No WhatsApp, confira também o status da mensagem na conversa.
- Revisão necessária: o resultado pode ter sido perdido após o envio, ou os dados da cobrança divergem. Não há repetição automática. Consulte o provedor e escolha confirmar envio ou repetir somente se verificou que não foi enviado. Uma repetição manual incorreta pode duplicar mensagens.
- Não enviado: desativado, anterior à ativação ou pagamento não está aberto.

A unicidade é por mensalidade e meio (e-mail/WhatsApp). O claim é gravado antes da chamada externa e resiste à concorrência entre processos. Envios travados por mais de 15 minutos vão para revisão. Desligar um envio não desfaz uma solicitação já em andamento. Não há garantia de entrega exata uma vez em redes externas; a rotina prioriza não repetir resultados incertos.

## API de anexos para o ERP

Use a chave gerada em Configurações → Integrações **no servidor do ERP**, nunca no navegador ou em código público.

1. `GET /public/v1/channels` para selecionar um canal da empresa.
2. `POST /public/v1/conversations` com JSON `{"channelId":"UUID_DO_CANAL","phone":"5531988887777","name":"Cliente Exemplo"}`. Guarde o `id` retornado. Se a conversa anterior foi finalizada, esse endpoint inicia outra.
3. Envie o arquivo:

```bash
curl --request POST \
  'https://nodus-inter.onrender.com/public/v1/conversations/UUID_DA_CONVERSA/attachments' \
  --header "Authorization: Bearer $NODUS_API_KEY" \
  --header 'Idempotency-Key: boleto-2026-11-cliente-123-v1' \
  --form 'file=@/caminho/boleto.pdf;type=application/pdf' \
  --form 'caption=Olá! Segue seu boleto com vencimento em 10/11.'
```

Não defina Content-Type manualmente: o cliente HTTP gera o boundary multipart. No Postman: Body → form-data; `file` do tipo File; `caption` do tipo Text. Headers: Authorization Bearer e Idempotency-Key.

Resposta de aceite:

```json
{"id":"UUID_DA_MENSAGEM","conversationId":"UUID_DA_CONVERSA","status":"SENT"}
```

Consulte `GET /public/v1/conversations/:id/messages` para acompanhar o status posterior. `SENT` aqui é aceite; uma falha assíncrona pode alterar o status para FAILED.

### Regras

- Uma requisição por destinatário/arquivo. Para lotes de boletos, o ERP usa uma fila, respeitando limites e consentimentos aplicáveis. A rota não recebe uma lista de centenas de destinatários numa chamada.
- Limite de upload: 10 por minuto por empresa; até 2 uploads simultâneos por processo; 10 MiB por arquivo. Limites gerais da API também se aplicam. Imagens Meta: até 5 MiB.
- Formatos de **envio**: PDF, JPEG, PNG e WebP (WebP indisponível no conector Meta atual). Legenda até 1.024 caracteres. Não se deve confundir com os formatos Office aceitos no **recebimento** da plataforma.
- O conteúdo do arquivo é validado, não apenas o nome. Não há download de uma URL arbitrária enviada pelo ERP, reduzindo o risco de SSRF.
- Meta exige janela de atendimento aberta para esse anexo. Fora dela, use o endpoint de template aprovado com link de cobrança em parâmetro de texto, ou aguarde o contato. Não é permitido contornar essa regra pela API Nodus.
- Chaves revogadas e empresas suspensas são bloqueadas. Uma conversa de outra empresa retorna 404 antes do upload ser processado.
- `Idempotency-Key`: 8–128 caracteres ASCII entre letras, números, `_ . : -`. Use um identificador estável por envio. Mesma chave, mesma conversa, mesmo nome/tipo/bytes de arquivo e legenda devolve o recibo anterior, sem novo envio. Conteúdo diferente retorna 409. A chave é isolada por empresa e armazenada como hash.
- 409 por processamento ou resultado incerto: consulte a conversa; **não gere outra chave automaticamente**. Timeout do cliente pode ocorrer depois que o provedor já aceitou. Mesmo uma validação rejeitada após a reserva pode deixar a chave em revisão; corrija e use outra chave somente após conferir que nada foi enviado.
- 429: respeite a janela de limite e tente novamente com a **mesma** chave. O controle de upload se aplica também às consultas repetidas de recibo via POST.
- A tabela de idempotência armazena hashes e um recibo mínimo, não outra cópia de PDF, telefone ou legenda. Não apague esses registros para tentar reenviar. Eles são removidos na exclusão da empresa.

## Validar em homologação

1. Antes de ativar contratos reais, use um contrato de teste, e-mail e telefone sob seu controle, Asaas Sandbox e canal de teste. Não use datas/pagamentos de clientes reais para simulação.
2. Configure o envio no Owner **antes** da emissão de uma mensalidade de teste pelo calendário. Confirme a emissão, o link/valor/vencimento e o histórico EMAIL/WHATSAPP. O endpoint `/billing/calendar/run` não força cobrança fora do calendário.
3. Execute a rotina novamente: a mesma mensalidade não deve gerar novos avisos.
4. Faça upload de um PDF fictício pela API do ERP; repita exatamente o mesmo pedido e chave; confira apenas uma mensagem. Troque a legenda mantendo a chave: espere 409.
5. Tente chave revogada, empresa suspensa e conversa de outra empresa: espere 401, 403 e 404 respectivamente.
6. Confira os status posteriores do WhatsApp. Aceite inicial não prova entrega.

Os testes automatizados usam provedores simulados e cobrem concorrência, idempotência, escopo de empresa, bloqueios, configuração do Owner, pagamentos não abertos e falhas incertas. Não houve envio real nesta implementação. O teste visual e a entrega real em homologação devem ocorrer depois do deploy.

Referências: https://docs.asaas.com/reference/atualizar-cliente-existente ; https://docs.asaas.com/docs/cobrancas-via-boleto ; https://resend.com/docs/dashboard/emails/idempotency-keys
