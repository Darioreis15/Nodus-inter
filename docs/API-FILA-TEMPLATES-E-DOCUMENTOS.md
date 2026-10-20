# Nodus — Fila de integração e documentos

API pública v1 · revisão 20/10/2026

Esta atualização adiciona uma fila persistente para envios de texto, anexos e templates Meta, além de PDF no cabeçalho de templates e documentos Word, Excel e PowerPoint nas rotas de anexos. Depende do deploy e da migration `20261020010000_api_deliveries`.

## Autenticação e identificação do envio

A chave API da empresa é reutilizada em todas as chamadas:

```http
Authorization: Bearer SUA_CHAVE_API_NODUS
```

`Idempotency-Key` não é uma credencial. É uma referência única de uma operação, criada pelo ERP. Exemplos: `fatura-123-parcela-01`, `fatura-124-parcela-01`. Nunca coloque a chave API neste campo.

Repetir a mesma chave e conteúdo na fila retorna o mesmo protocolo. Mudar conversa, texto, parâmetros, legenda, nome/MIME ou bytes do arquivo retorna 409. A mesma chave pode ser usada por empresas diferentes sem colisão. O escopo da fila é separado do escopo das rotas imediatas: **não alterne de rota para repetir um envio incerto**, pois isso pode duplicá-lo.

URL base: `https://nodus-inter.onrender.com/public/v1`.

## Preparar o destinatário

Consulte `GET /channels` e escolha um canal conectado da empresa. Abra ou reutilize uma conversa:

```http
POST /conversations
Content-Type: application/json
```

```json
{
  "channelId": "11111111-1111-4111-8111-111111111111",
  "phone": "31999999999",
  "name": "Cliente Exemplo"
}
```

Para Brasil, DDD + número é aceito; o backend normaliza o código 55. Para outros países, use `+DDI`. Guarde `id` da resposta como `conversationId`. A criação da conversa não envia mensagem.

## Registrar um envio na fila

```http
POST /conversations/:id/deliveries
Authorization: Bearer SUA_CHAVE_API_NODUS
Idempotency-Key: fatura-123-parcela-01
```

Uma solicitação corresponde a **um destinatário e no máximo um arquivo**. Não há upload de um ZIP com mil faturas nem envio de mil PDFs em uma única requisição.

### Texto — JSON

```json
{"kind":"TEXT","text":"Olá! Sua fatura está disponível em https://seu-erp.example/fatura/123"}
```

### PDF ou Excel — multipart/form-data

| Campo | Tipo | Exemplo |
|---|---|---|
| kind | Texto | ATTACHMENT |
| caption | Texto opcional | Segue a fatura em Excel. |
| file | Arquivo | fatura.xlsx |

Deixe a biblioteca HTTP gerar o boundary do multipart. Não envie o arquivo como URL ou base64 em JSON.

### Template Meta com PDF — multipart/form-data

| Campo | Tipo | Exemplo |
|---|---|---|
| kind | Texto | TEMPLATE |
| name | Texto | fatura_disponivel |
| language | Texto | pt_BR |
| parameters | Texto contendo array JSON | ["Cliente Exemplo","99,00","10/11/2026"] |
| file | Arquivo PDF opcional | boleto.pdf |

O template deve existir, estar aprovado na conta e ter cabeçalho DOCUMENT compatível. Os parâmetros seguem a ordem do corpo do template. Sem variáveis, use `[]`. Botões dinâmicos e parâmetros nomeados não são implementados por esta rota.

O backend carrega o PDF na Meta e envia **uma única mensagem template**, com o documento no cabeçalho e os parâmetros no corpo. Não envia template e PDF como duas mensagens separadas. Excel não é aceito no cabeçalho PDF; use a rota de anexos, sujeita à janela de atendimento Meta.

Para template sem arquivo, também é aceito JSON:

```json
{"kind":"TEMPLATE","name":"aviso_financeiro","language":"pt_BR","parameters":["Cliente Exemplo","https://seu-erp.example/fatura/123"]}
```

### Resposta

`202 Accepted` confirma que o item foi persistido. Exemplo resumido:

```json
{
  "id":"22222222-2222-4222-8222-222222222222",
  "conversationId":"33333333-3333-4333-8333-333333333333",
  "kind":"TEMPLATE",
  "state":"QUEUED",
  "messageId":null,
  "attempts":0
}
```

A resposta completa inclui datas, prazo de expiração e `errorCode`. Aceite não comprova entrega. Em caso de timeout no aceite, repita **a mesma rota, chave e conteúdo** para recuperar o protocolo.

## Consultar e cancelar

| Método | Rota | Finalidade |
|---|---|---|
| GET | /deliveries/:id | Protocolo e status atual da mensagem |
| GET | /deliveries?cursor=ID | Até 100 protocolos da empresa, com nextCursor |
| DELETE | /deliveries/:id | Cancela apenas um item QUEUED |

A listagem da fila usa ordem por ID, estável para paginação; não é ordenação cronológica. O detalhe inclui `messageStatus`, consultado no registro da mensagem. Os estados da fila são:

| state | Significado |
|---|---|
| QUEUED | Aguardando processamento ou nova tentativa segura |
| PROCESSING | Reservado pelo worker; cancelamento não permitido |
| SENT | Envio registrado; consultar messageStatus para entrega/leitura/falha |
| FAILED | Rejeição definitiva, expiração ou tentativas esgotadas |
| REVIEW | Resultado incerto; conferir a conversa antes de qualquer novo envio |
| CANCELLED | Cancelado pelo cliente ou por condição de acesso/destinatário |

`messageStatus` pode ser SENT, DELIVERED, READ ou FAILED conforme eventos do provedor. Não reenviar automaticamente um item REVIEW com outra chave.

## Ritmo, limites e mil boletos

O recebimento e o processamento são independentes. A fila não usa o limite HTTP como autorização para disparar 299 mensagens simultâneas.

- Limites HTTP existentes continuam: 300/minuto por IP e 600/minuto por empresa.
- Upload imediato continua com 10 tentativas/minuto por empresa.
- Upload para fila: padrão 10/minuto por empresa; configurável até 60.
- Processamento: padrão 10 envios/minuto por empresa; configurável até 60, distribuídos no tempo e compartilhados entre réplicas. Há no máximo um envio em processamento por empresa.
- Até dois uploads simultâneos por processo; excesso retorna 503 sem aceite.
- Arquivo: até 10 MiB; imagem Meta até 5 MiB. A janela Meta é verificada novamente no processamento de texto e anexos comuns.
- Capacidade padrão: 128 MiB por empresa e 256 MiB no total, medidos pelo payload criptografado. Base64/criptografia aumentam o tamanho armazenado. Também há teto de 10.000 protocolos por empresa e 100.000 globais dentro da retenção.
- Limite de armazenamento retorna 429 com `retryAfter`, sem registrar o item. O ERP mantém o que ainda não foi aceito e retoma depois. Se o teto for de protocolos retidos, aguardar um minuto pode não liberar capacidade; contate a operação Nodus.

Para mil PDFs, o ERP envia gradualmente, registra cada protocolo e repete apenas as solicitações não confirmadas com a mesma chave/conteúdo. Ao ritmo padrão, o processamento leva pelo menos cerca de 100 minutos, além do tempo do provedor e de pausas. Não há garantia de concluir um lote dentro desse prazo. A capacidade disponível pode não comportar mil PDFs ao mesmo tempo; o produtor deve respeitar 429/503 e acompanhar o escoamento.

Recusas explícitas e temporárias da Meta recebem espera crescente e até cinco tentativas. Timeouts durante o envio da mensagem e reinícios após a reserva levam a REVIEW, sem reenvio automático, pois o provedor pode ter recebido a mensagem. Um upload de mídia que falhou antes de submeter a mensagem pode ser repetido. Falhas assíncronas informadas por webhook aparecem em `messageStatus`; não são reenviadas automaticamente.

## Formatos de documentos

As rotas `/attachments` e a fila ATTACHMENT aceitam PDF, JPEG, PNG, WebP, DOC, DOCX, XLS, XLSX, PPT e PPTX. WebP não é enviado pelo conector Meta. Os arquivos Office passam por verificação de formato; OOXML com macros incorporadas, objetos ActiveX/embutidos, caminhos inseguros ou estrutura inválida é recusado. A validação não substitui antivírus. Documentos são disponibilizados para download, não executados no navegador.

**Excel significa transmitir a planilha que o ERP já gerou.** Esta atualização não calcula faturas, não exporta dados financeiros em planilhas e não converte PDF em Excel. Para gerar uma planilha dentro da Nodus, será necessário definir a origem e as colunas dos dados.

## Rota imediata existente de templates

`POST /conversations/:id/template` continua aceitando JSON com `name`, `language` e `parameters`.

Também passa a aceitar multipart com os mesmos três campos e `file` PDF. Neste caso, `Idempotency-Key` é obrigatório. No JSON, enviar a chave é opcional para manter compatibilidade, mas recomendado para obter proteção contra repetição. A resposta com chave é um recibo mínimo (`id`, `conversationId`, `status`). Sem chave, preserva o contrato anterior.

Essa rota é imediata e retorna 201; **não usa a fila**. Resultado incerto deve ser conciliado manualmente. O mesmo vale para anexos imediatos.

## Segurança e retenção

As chamadas e consultas são isoladas por empresa. Arquivos e conteúdo pendentes ficam criptografados com `DATA_ENCRYPTION_KEY`. Não é armazenada a chave API original. Revogar a chave, suspender a empresa, fechar a conversa, desconectar o canal ou registrar opt-out impede novos despachos da fila assim que a condição é verificada. Não é possível retirar uma mensagem já submetida ao provedor.

A nova fila respeita a lista de supressão existente da empresa. As rotas imediatas mantêm seu comportamento; a integração deve continuar respeitando preferências e finalidades de contato.

O payload é removido ao finalizar, cancelar ou colocar em revisão. Itens pendentes expiram após sete dias. Protocolos terminais e suas chaves são removidos após 90 dias sem atualização. Depois dessa retenção, a chave não evita um novo envio; mantenha o histórico de negócio no ERP. Excluir a conversa/contato/empresa remove os registros de fila relacionados por cascade. O conteúdo que já foi enviado continua sujeito às regras de retenção das mensagens e do provedor.

## Ativação no Render

1. Faça merge e deploy. O start existente deve executar `npx prisma migrate deploy` antes de iniciar o backend. Não rode seed ou db push para esta alteração.
2. Mantenha a mesma `DATA_ENCRYPTION_KEY` já utilizada. Não substitua a chave enquanto houver dados criptografados.
3. Configure `API_QUEUE_ENABLED=true` para aceitar e processar itens.
4. Escolha o executor:
   - Serviço sempre ativo: `API_QUEUE_WORKER_ENABLED=true`; o backend verifica a fila a cada segundo.
   - Render sujeito a suspensão: `API_QUEUE_WORKER_ENABLED=false` e runner contínuo no Contabo, descrito abaixo. A disponibilidade ainda depende do Render; a fila persiste durante interrupções.
5. Defina `API_QUEUE_RUN_TOKEN` aleatório com pelo menos 32 caracteres se utilizar o runner externo.
6. Comece com 10 envios/minuto. Aumente somente após medir memória, banco, tempos de resposta e capacidade da conta Meta. Não altere o limitador HTTP geral.

## Runner no Contabo, sem Docker

Node.js 20 ou superior. Copie `scripts/run-api-deliveries.cjs` para `/opt/nodus-api-deliveries/run-api-deliveries.cjs` e o arquivo de serviço de `deploy/` para `/etc/systemd/system/nodus-api-deliveries.service`.

Crie o usuário e o diretório (se ainda não existirem):

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin nodus-queue
sudo install -d -m 750 -o root -g nodus-queue /opt/nodus-api-deliveries
```

Crie `/opt/nodus-api-deliveries/runner.env`:

```dotenv
NODUS_API_BASE_URL=https://nodus-inter.onrender.com
API_QUEUE_RUN_TOKEN=O_MESMO_TOKEN_CONFIGURADO_NO_RENDER
```

Proteja o arquivo com proprietário root, grupo nodus-queue e permissão 640. O script deve ser legível pelo usuário do serviço. Confira `command -v node` e ajuste `ExecStart` se não for `/usr/bin/node`.

```bash
sudo chown root:nodus-queue /opt/nodus-api-deliveries/runner.env
sudo chmod 640 /opt/nodus-api-deliveries/runner.env
sudo systemctl daemon-reload
sudo systemctl enable --now nodus-api-deliveries
sudo systemctl status nodus-api-deliveries
sudo journalctl -u nodus-api-deliveries -n 30 --no-pager
```

O runner chama uma operação por vez, sem expor tokens nos logs. É independente do calendário de cobrança existente. Não substitua o serviço de faturamento. Tokens inválidos encerram a execução; demais falhas aguardam e tentam consultar novamente, sem repetir diretamente a mensagem.

## Homologação antes de clientes

Importe `Nodus-Fila.postman_collection.json` e `Nodus-Fila.postman_environment.json`, disponíveis nesta pasta. Preencha as variáveis privadas e execute cada requisição separadamente. Selecione o arquivo local em `file`, ajuste parâmetros ao template real e troque `idempotencyKey` entre operações distintas. Não execute toda a coleção automaticamente.

- Enfileirar texto e um arquivo fictício; receber 202 e consultar o mesmo protocolo.
- Repetir chave/conteúdo: mesmo protocolo; alterar arquivo: 409.
- Confirmar que nenhum envio ocorre com o worker desligado; habilitar e observar processamento.
- Validar um template real da empresa, aprovado com cabeçalho PDF, e conferir entrega no destinatário.
- Enviar XLSX em um canal autorizado; para Meta, usar conversa dentro da janela de atendimento.
- Cancelar item pendente, revogar uma chave de teste e testar isolamento entre duas empresas.
- Acompanhar limites com pequenos lotes antes de enviar faturamento real.

Os testes automatizados utilizam provedores simulados e banco PostgreSQL embarcado. A entrega real pela Meta e a capacidade do ambiente precisam ser validadas com a conta da empresa.
