# Nodus — conta, setores, automações e campanhas

## Publicação desta atualização

1. Faça o merge do PR no GitHub e aguarde o deploy do backend no Render.
2. Mantenha o build `npm ci --include=dev && npx prisma generate && npm run build` e o start `npx prisma migrate deploy && npm run start:prod`.
3. O deploy aplica duas migrações novas. Não use `db push` ou seed para esta atualização. A primeira identifica o cadastro mais antigo ainda existente de cada empresa como administrador principal; empate de datas é resolvido pelo ID. Esse usuário fica ADMIN. A outra cria a fila de campanhas.
4. No Hostinger, substitua os arquivos do **subdomínio app.nodusintegracao.com** pelos arquivos da pasta `frontend` deste pacote. Não substitua o site institucional.
5. Para começar sem enviar nada, deixe `CAMPAIGNS_WORKER_ENABLED=false` no Render. Depois do teste de criação, configure `true` e faça novo deploy para processar a fila.
6. Nenhuma outra variável nova é necessária. FRONTEND_URL, Resend, CORS e credenciais dos canais continuam sendo as já configuradas.

O backend deve estar atualizado antes do frontend. Agendamentos são persistidos no PostgreSQL. O processamento funciona enquanto o processo Node está executando; se o serviço adormecer ou ficar indisponível, os envios atrasam e retomam depois. Para pontualidade em operação real, use um processo continuamente ativo.

## Contas e equipe

- O administrador principal tem um selo e não pode ser excluído nem ter seu perfil alterado pelas rotas normais ou de exclusão individual de privacidade.
- Os demais administradores e operadores podem ter o perfil alterado ou o acesso excluído por um administrador. Alterar perfil revoga as sessões. Excluir libera a vaga do plano, desatribui atendimentos e preserva o histórico de conversas.
- O principal também pode alterar seu próprio e-mail e senha. Proteção de propriedade não significa bloquear seus dados de login.
- Configurações → Alterar meu e-mail exige senha atual e confirmação do novo endereço. A alteração é imediata: confira o endereço, pois ele será usado no próximo login e na recuperação. Não é uma verificação de posse via link.
- Configurações → Alterar minha senha exige a senha atual e confirmação. Entre novamente após a troca.
- Operadores veem suas configurações pessoais; expediente e chaves de integração permanecem restritos aos administradores.

## Passo a passo: cliente responde X, avança e vai para um atendente

### Exemplo: Financeiro → segunda via → Ana

1. Em **Operadores**, cadastre Ana e confira **Disponibilidade**. Ela precisa estar disponível dentro do horário configurado para receber atribuição automática.
2. Em **Configurações**, configure o expediente e o fuso da empresa.
3. Em **Automações → Setores de atendimento**, crie **Financeiro** e **Administrativo**. Clique em **Salvar setores**.
4. Em **Boas-vindas por canal**, escolha o canal, ative e escreva: `Olá! Digite 1 para Financeiro ou 2 para Administrativo.` Salve. Essa mensagem é enviada no início de uma conversa, não em cada mensagem recebida.
5. Adicione a etapa abaixo em **Regras de conversa**:

| Campo | Valor |
| --- | --- |
| Nome | Financeiro |
| Palavra-chave | 1 |
| Etapa anterior | Qualquer etapa |
| Mensagem | Você está no Financeiro. Digite BOLETO para segunda via ou ATENDENTE para falar com nossa equipe. |
| Encaminhar para setor | Financeiro |
| Atendente após a resposta | Manter na fila |

6. Adicione outra etapa:

| Campo | Valor |
| --- | --- |
| Nome | Segunda via |
| Palavra-chave | BOLETO |
| Etapa anterior | Financeiro |
| Mensagem | Vou encaminhar você para Ana, que ajudará com a segunda via. |
| Encaminhar para setor | Financeiro |
| Atendente após a resposta | Ana |

7. Se quiser a opção ATENDENTE, crie uma terceira etapa com essa palavra-chave, origem Financeiro, setor Financeiro e atendente Ana.
8. Para o Administrativo, crie uma etapa com palavra-chave `2`, origem Qualquer etapa, mensagem correspondente e setor Administrativo.
9. Clique em **Salvar automações**. Pelo celular de teste, envie uma nova mensagem, depois `1` e depois `BOLETO`.
10. Na Caixa de entrada, filtre pelo setor Financeiro. A conversa estará na etapa Segunda via e atribuída a Ana se ela estiver disponível. Caso contrário, ficará na fila para alguém assumir.

A palavra-chave precisa corresponder à mensagem inteira; espaços nas pontas e maiúsculas/minúsculas são ignorados. Uma origem específica tem prioridade sobre “Qualquer etapa”. A mesma palavra pode ter comportamentos diferentes em etapas anteriores diferentes. Voltar à mesma etapa não repete a resposta automaticamente.

O setor organiza a fila, não restringe a visualização aos membros de um grupo: os operadores da empresa podem atender todos os setores. O botão **Setor** dentro da conversa permite transferir manualmente e libera o atendente anterior. Excluir um setor coloca suas conversas sem setor e remove o destino das boas-vindas. A atribuição à fila é preservada mesmo se o provedor falhar ao entregar a resposta automática.

Fora do expediente, a resposta de ausência tem prioridade sobre as palavras-chave. Configure seu setor de destino no mesmo formulário. Para repetir o teste das boas-vindas, resolva a conversa anterior e envie uma nova mensagem.

## Campanhas e sequências de follow-up

1. Abra **Campanhas** como administrador.
2. Dê um nome, escolha o canal e defina data/hora. O formulário informa o fuso do dispositivo utilizado.
3. Insira os destinatários, um por linha: `telefone;nome;link;valor`. Exemplo fictício:

```text
5511999999999;Maria;https://suaempresa.example/boleto/123;99,00
5511888888888;João;https://suaempresa.example/boleto/456;149,00
```

4. Na primeira mensagem, use atraso `0` e, em canal QR Code, texto como `Olá {{nome}}, seu boleto de R$ {{valor}} está em {{link}}. Para cancelar os avisos, responda SAIR.`
5. Clique em **+ Follow-up**. Para um lembrete no dia seguinte, use `1440` minutos. Os intervalos são contados a partir do horário inicial, não da entrega da mensagem anterior, e devem crescer. Se houver atraso do servidor, etapas vencidas podem ser processadas em sequência; revise ou pause campanhas antigas antes de reativar um servidor parado.
6. Mantenha **Interromper a sequência quando o cliente responder** marcado quando quiser encaminhar a resposta para atendimento humano. Qualquer mensagem recebida nesse canal depois da criação cancela as etapas ainda na fila daquele destinatário, inclusive se chegar antes do horário agendado.
7. Confirme a autorização dos destinatários, clique em **Revisar agendamento** e confira as quantidades antes de confirmar.
8. Em **Ver envios**, acompanhe fila, envio, resultado incerto e retorno do provedor. Há paginação a cada 100 registros. Pause, retome ou cancele pelo painel.

Para canais Meta, esta versão exige **template aprovado em todas as etapas das campanhas**, inclusive quando houver janela aberta. Informe o nome exato, idioma e parâmetros de corpo, um por linha. As variáveis `{{nome}}`, `{{link}}` e `{{valor}}` são substituídas individualmente. Não são gerados boletos: o sistema de cobrança fornece um link HTTPS válido para cada destinatário. PDF anexado e templates com cabeçalhos de mídia/botões não estão incluídos nesta entrega.

Limites desta implementação: até 100 destinatários por campanha, 10 etapas e 5.000 envios pendentes por empresa. São limites operacionais da fila, não novos limites comerciais dos planos. O envio é gradual: um por ciclo de cinco segundos por processo, com trava adicional por empresa. Isso não garante aprovação de conteúdo, entrega ou ausência de bloqueios do provedor.

Respostas **SAIR, PARAR, STOP ou CANCELAR** impedem novas campanhas para aquele telefone na empresa. Não há botão que remova essa recusa nesta versão. Respostas comuns interrompem somente as sequências configuradas para parar. Conversas humanas podem continuar.

Uma mensagem já despachada pode terminar após uma pausa, resposta ou cancelamento. Falhas de resultado incerto não são repetidas automaticamente, evitando duplicar cobrança. Confira o provedor antes de criar outro envio. Uma etapa posterior não é enviada se a anterior ficou incerta/ignorada ou tem falha conhecida.

A fila não envia se empresa estiver suspensa, canal desconectado ou campanha pausada. Revogar a chave que criou uma campanha via API impede seus próximos despachos. Excluir um contato pela privacidade exclui também os registros da fila vinculados a ele. Payloads concluídos são removidos da fila; o histórico de envios concluídos acompanha MESSAGE_RETENTION_DAYS quando a rotina de retenção é executada e a campanha não tem mais pendências, respeitando preservação legal.

## API do sistema do cliente

Base: `https://nodus-inter.onrender.com/public/v1`

Todas as chamadas usam:

```http
Authorization: Bearer SUA_CHAVE_NODUS
Content-Type: application/json
```

Crie a chave em **Configurações → Integração — API aberta**. Guarde no backend do ERP/CRM, nunca no JavaScript público do site. Essa é a chave Nodus, não a chave da Evolution ou o token da Meta.

Use `GET /channels` nessa base pública para obter os IDs dos canais da própria empresa, sem expor credenciais dos provedores.

### Envio individual

1. `POST /conversations` com `{"channelId":"UUID_DO_CANAL","phone":"5511999999999","name":"Maria"}`.
2. Use o ID retornado em `POST /conversations/ID/messages` com `{"text":"Olá, Maria! Seu boleto: https://suaempresa.example/boleto/123"}`.
3. Na Meta, fora da janela de atendimento, use `POST /conversations/ID/template` com `{"name":"aviso_boleto","language":"pt_BR","parameters":["Maria","https://suaempresa.example/boleto/123"]}`. O template deve existir e estar aprovado.

O envio direto é síncrono e não tem chave de idempotência. Para notificações financeiras em que você precisa repetir uma requisição com segurança após perder a resposta HTTP, prefira uma campanha com um destinatário e uma etapa.

### Envio em lote e follow-ups

`POST /campaigns`:

```json
{
  "name": "Boletos de outubro",
  "channelId": "UUID_DO_CANAL",
  "requestKey": "boletos-outubro-lote-001",
  "scheduledAt": "SUBSTITUA_POR_DATA_ISO_FUTURA_COM_FUSO",
  "consentConfirmed": true,
  "stopOnReply": true,
  "recipients": [
    { "phone": "5511999999999", "name": "Maria", "link": "https://suaempresa.example/boleto/123", "value": "99,00" }
  ],
  "steps": [
    { "delayMinutes": 0, "type": "TEXT", "text": "Olá {{nome}}, boleto de R$ {{valor}}: {{link}}. Responda SAIR para cancelar os avisos." },
    { "delayMinutes": 1440, "type": "TEXT", "text": "Olá {{nome}}, este é um lembrete sobre seu boleto: {{link}}." }
  ]
}
```

Datas devem usar ISO 8601 com fuso, por exemplo `2026-10-06T10:00:00-03:00`, substituído pela data desejada. No Postman você pode gerar uma data futura via script: `pm.environment.set("envio_em", new Date(Date.now()+120000).toISOString())` e usar `"scheduledAt":"{{envio_em}}"`.

Para Meta, substitua cada etapa por:

```json
{ "delayMinutes": 0, "type": "TEMPLATE", "template": { "name": "aviso_boleto", "language": "pt_BR", "parameters": ["{{nome}}", "{{link}}"] } }
```

Repetir **o mesmo corpo** com a mesma `requestKey` retorna o mesmo ID, sem criar novos envios. Reutilizar a chave com outro conteúdo retorna 409. Preserve também a data original no retry. Para mais de 100 destinatários, envie lotes distintos com chaves distintas, respeitando as 5.000 pendências.

- `GET /campaigns`: últimas 100 campanhas.
- `GET /campaigns/ID`: histórico por destinatário; use `?cursor=NEXT_CURSOR` para continuar.
- `PATCH /campaigns/ID` com `{"state":"PAUSED"}`, `{"state":"ACTIVE"}` ou `{"state":"CANCELLED"}`.
- O retorno `SENT` significa aceito pelo provedor. `deliveryStatus` mostra o status de mensagem atualizado pelo webhook quando disponível.

## Teste de homologação sugerido

1. Com worker desativado, crie uma campanha para **seu próprio número**, com duas etapas (0 e 3 minutos). Veja que fica na fila sem enviar.
2. Ative o worker no Render. Confirme somente uma primeira mensagem; responda antes de três minutos e confira que o follow-up foi ignorado.
3. Em outra campanha, teste pausa, retomada e cancelamento. Para validar reinício, deixe uma mensagem para cinco minutos, reinicie antes do vencimento e confira que permanece na fila.
4. No Postman, repita o mesmo POST com a mesma requestKey e confira que retorna o mesmo ID.
5. Teste a recusa SAIR com um número exclusivamente de teste, pois esta versão não oferece remoção da recusa.
6. Faça um teste de template Meta somente quando a conta estiver elegível e puder entregar mensagens. Um ID retornado pela API não é prova de entrega.

Nenhum envio real foi feito nos testes automatizados desta entrega.
