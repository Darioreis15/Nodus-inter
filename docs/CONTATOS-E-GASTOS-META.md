# Contatos com nono dígito e Gastos Meta

## Publicação

1. Fazer merge e aguardar o deploy do backend no Render.
2. Publicar o conteúdo de `frontend/` no subdomínio do app na Hostinger. Manter `owner/` como subpasta.
3. Limpar o cache e entrar novamente. `index.html` passa a carregar `app.js?v=37-meta-costs` e o novo módulo `meta-costs.js`.

Não há migração de banco, seed ou variável de ambiente nova nesta alteração.

## Telefones

As representações brasileiras `55 + DDD + celular antigo de 8 dígitos` e `55 + DDD + 9 + celular antigo` são pesquisadas como aliases. A equivalência é limitada a DDD válido e ao prefixo móvel antigo 6–9. Fixos, internacionais e identificadores de grupo não são encurtados. A normalização de DDD/55 na entrada continua existente.

A resolução prioriza o contato que já possui atendimento OPEN/PENDING no mesmo canal. Sem atendimento ativo, reutiliza um contato existente. Só cria contato quando nenhum alias existe. A busca/criação ocorre dentro da transação com bloqueio da empresa. Vale para abertura manual, API, entrada de mensagens, eco de anexo e criação de campanhas. Reabrir um histórico é bloqueado se o alias já tiver atendimento ativo naquele canal.

Históricos RESOLVED continuam separados por atendimento. Conversas de canais ou empresas diferentes também permanecem separadas. Não se apagam nem se fundem automaticamente históricos antigos duplicados: novos eventos passam a preferir o contato ativo escolhido de forma estável. Se já existem dois contatos com conversas ativas, o contato criado primeiro é priorizado; o outro histórico permanece disponível para conferência/encerramento.

Opt-out considera ambas as representações, inclusive registros antigos. Listas de campanhas com dois destinatários que resolvem para o mesmo contato são recusadas para revisão; não são enviadas duas vezes.

### Teste

- No mesmo canal, iniciar conversa com `3198051379` e depois `31998051379` (usar somente um destinatário de teste sob seu controle).
- Confirmar o mesmo ID de conversa ativa, tanto no app quanto na API.
- Receber uma resposta e conferir que entrou no atendimento já aberto.
- Repetir com um canal/empresa diferentes: não devem compartilhar atendimento.
- Confirmar que números fixos/internacionais não são associados indevidamente.

## Gastos Meta

Nova aba exclusiva de ADMIN: **Gastos Meta**. Selecionar canal OFFICIAL_META e mês. O relatório consulta `pricing_analytics` da Meta e mostra:

- custo aproximado disponibilizado pela Meta, na moeda da conta;
- volume informado, dia UTC, categoria e tipo de cobrança;
- data da consulta; cache de até cinco minutos por processo;
- indisponibilidade explícita quando não existem dados, moeda ou custo completo.

Não se aplica aos canais via QR Code. Não inclui a mensalidade Nodus, não calcula câmbio e não representa comprovante de pagamento/fatura definitiva. Abrange o número selecionado, inclusive envios desse número por outros sistemas. Não se somam contas/moedas diferentes.

O canal precisa de token válido com acesso à WABA e permissões de gerenciamento WhatsApp. A Meta pode restringir custos/permissões conforme a conta ou o parceiro. Falha de autenticação não é apresentada como gasto zero.

### Vincular a conta

Na própria aba, abrir **Configurar conta Meta**, selecionar o canal acima e informar seu WABA ID. O backend verifica que o número do canal pertence à conta antes de salvar. O token já cadastrado em Conexões permanece no backend; ele não é enviado ao navegador.

### Rotas internas do app

- `GET /reports/meta-costs?channelId=<UUID>&month=AAAA-MM`
- `PATCH /reports/meta-costs/:channelId/account` com `{ "wabaId": "123456789" }`

Exigem JWT de ADMIN e empresa ativa. Não são rotas da API pública com chave do ERP. Há isolamento por empresa e filtro/validação do número na consulta à Meta. A configuração WABA não muda canal, assinatura ou credenciais de WhatsApp.

São aceitos o mês atual e os 11 anteriores; o mês atual é consultado até o instante da requisição. Datas no relatório estão em UTC. Não seguir URLs de paginação retornadas pelo provedor; consultas de números usam cursores no host Graph fixo e limites de páginas. Analytics incompleto é recusado, não apresentado como total definitivo.

### Validação após deploy

1. Entrar como ADMIN; verificar a aba. AGENT não deve acessá-la nem consultar as rotas.
2. Consultar mês/canal com dados disponíveis e comparar com o painel Meta usando mesmo período, número e moeda.
3. Verificar tratamento de token vencido, WABA incorreta e custo indisponível.
4. Sem canal oficial, verificar o estado vazio explicativo.

Testes automatizados usam respostas simuladas da Meta. A consulta real de custos precisa ser validada com uma WABA autorizada após deploy. A conta com restrição de acesso pode impedir essa validação.

Referências oficiais consultadas em 22/10/2026:
- https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/pricing_analytics/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics/
- https://www.facebook.com/business/help/511126334359303
