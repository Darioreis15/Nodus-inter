# Funil automático

## Publicar
1. Faça merge do PR e aguarde o deploy do backend. O build deve executar prisma generate e a inicialização prisma migrate deploy, como já configurado. Nova migration: 20261019020000_automatic_funnel. Não execute seed/db push.
2. Envie o conteúdo do ZIP para a raiz do app na Hostinger e preserve owner. Recarregue com Ctrl+F5.
3. Abra Funil. Há quatro colunas fixas: Aguardando atendimento, Em atendimento, Aguardando resposta e Finalizado. O quadro consulta até 100 conversas por status (OPEN/PENDING/RESOLVED), sem misturar empresas, e atualiza a cada 15 segundos enquanto visível.

## Configurar 10 minutos
Em Funil → Configurar prazo de resposta, marque a opção de mover automaticamente e informe 10. Salve. O padrão já é 10 minutos. Somente ADMIN altera a configuração.
- Assumir: Em atendimento.
- Enviar texto, template manual/API ou anexo pelo app: Em atendimento e prazo salvo no banco.
- Sem resposta após o prazo: Aguardando resposta.
- Cliente responder antes ou depois: cancela o prazo e volta a Em atendimento se há operador; caso contrário, Aguardando atendimento.
- Resolver: Finalizado, cancela o prazo e mantém o histórico consultável. Para continuar um atendimento encerrado, use Nova conversa.
- Transferir setor manualmente: libera operador, cancela prazo e volta à fila.
- Campanhas e respostas automáticas não iniciam esse prazo. Mensagens enviadas diretamente no celular também não iniciam o prazo nesta versão.
A configuração desativa somente a mudança por prazo. Mudar o número de minutos vale para os próximos envios; desligar a opção cancela prazos pendentes. Conversas antigas são distribuídas pelo status atual e responsável, sem inventar prazos retroativos.

## Palavra-chave → setor + coluna
1. Em Automações → Setores, crie Financeiro.
2. Em Regras e etapas, crie/edite uma automação.
3. Nome: Atendimento financeiro. Palavra-chave: 1. A comparação é exata, ignorando maiúsculas e espaços nas pontas. Para aceitar também financeiro, crie outra regra com essa palavra.
4. Mensagem: Qual é sua dúvida sobre o financeiro?
5. Coluna do funil ao encaminhar: Aguardando atendimento. Setor: Financeiro.
6. Marque Aguardar resposta livre e defina a confirmação: Obrigado! Um atendente do Financeiro vai te atender.
7. Salve automações. A pergunta é enviada no primeiro passo; após a resposta textual, setor e coluna são aplicados e o cliente permanece na fila, sem atribuição automática. Sem espera livre, o setor/coluna são aplicados imediatamente; pode selecionar operador disponível.
As regras ficam pausadas quando um operador assume ou quando o fluxo termina. Etapa anterior continua controlando a sequência de perguntas, independentemente da coluna do funil. O botão Etapas das automações preserva o quadro antigo para quem já o utilizava. Finalizado só ocorre por ação de encerramento, não por uma palavra-chave.

## Processo em segundo plano
O servidor confere os prazos a cada 30 segundos, no máximo 200 conversas por ciclo. O navegador pode ficar fechado. Datas persistidas sobrevivem a reinícios; respostas, encerramentos e novos envios invalidam a transição antiga. Atualizações concorrentes usam condição e bloqueio no banco.
O processamento depende de o backend estar em execução. Em um Render que durma por inatividade, os prazos atrasam até o serviço acordar. Para previsibilidade, use serviço sempre ativo ou um agendamento no Contabo chamando o endpoint abaixo. Em filas grandes pode haver mais de um ciclo até processar todos.

### Agendamento opcional no Contabo
Gere um segredo aleatório de pelo menos 32 caracteres e configure FUNNEL_RUN_TOKEN no Render. No Contabo, crie /opt/nodus/funnel.env (permissão 600), com NODUS_API_BASE_URL=https://nodus-inter.onrender.com e o mesmo FUNNEL_RUN_TOKEN. Copie scripts/run-funnel.cjs para /opt/nodus/run-funnel.cjs. Com Node 20+, adicione via crontab -e:

* * * * * /usr/bin/flock -n /opt/nodus/funnel.lock /bin/sh -c 'set -a; . /opt/nodus/funnel.env; set +a; /usr/bin/node /opt/nodus/run-funnel.cjs' >> /opt/nodus/funnel.log 2>&1

Confirme os caminhos de node e flock com command -v antes de usar. O script só processa prazos, não envia mensagens. Endpoint: POST /internal/funnel/run, header x-funnel-run-token. Nunca configure esse segredo no frontend. O cron não foi instalado automaticamente e não garante precisão durante indisponibilidade do Render/rede.

## Validar
Use 1 minuto temporariamente: assuma uma conversa, envie texto e confira Em atendimento; após prazo + até 30 segundos de processamento + 15 segundos de atualização, confira Aguardando resposta. Responda pelo celular e confirme retorno. Repita respondendo antes do prazo, enviando uma nova mensagem e resolvendo antes do vencimento. Teste a regra 1, a resposta livre e o setor selecionado. Volte o prazo para 10 minutos.

Build, testes de regras/retensão de estado/corridas, envio de anexos, campanhas, validação e migração PostgreSQL embarcada passaram. Validação visual em navegador e ponta a ponta com WhatsApp precisam ser feitas após publicação.
