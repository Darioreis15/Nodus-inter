# Planos, conversas e nome da conexão

Após o merge e deploy, publique os arquivos frontend no subdomínio app, mantendo owner/ como subpasta. Não publique na raiz do site institucional. Atualize o navegador com Ctrl+F5.

## Troca de plano
No Owner, escolha a empresa, Trocar plano, selecione o plano e confirme preço/limites e sua senha. Os limites mudam imediatamente. O preço de catálogo selecionado fica agendado para o próximo mês (horário de São Paulo). O calendário emite no Asaas com esse valor, no fluxo dia 1/vencimento dia 10. Não se cria cobrança na troca; cobranças já emitidas são preservadas. Trocas repetidas no mesmo mês substituem o preço pendente. As opções de boleto, multa, juros e avisos são preservadas.

Sem contrato, a troca define o plano usado na futura contratação. Contratos cancelados ou com cancelamento pendente não permitem troca. Contratos legados devem concluir a migração para o calendário Nodus. O registro base billingPriceCents permanece como preço original; a agenda em billingOptions.planPriceSchedule determina o valor de cada competência.

## Conversas
Novas entradas e abertura manual já reutilizam a conversa OPEN/PENDING do contato no mesmo canal. Agora reabrir um atendimento antigo verifica, sob a mesma trava de canal, se existe outro ativo, e retorna 409 quando existir. Atendimentos finalizados são mantidos como histórico; canais distintos mantêm atendimentos separados. Não há fusão nem exclusão de conversas antigas. Telefones distintos não são fundidos por semelhança.

## Nome
A conexão QR Code aparece como Nodus no app e Owner, inclusive mensagens de erro do conector. QR_EVOLUTION, variáveis EVOLUTION_*, webhook e configuração do servidor permanecem como identificadores técnicos. Não é necessário alterar Docker ou credenciais.

## Validação
Testes de preço por competência, troca repetida, legado, valor enviado ao Asaas simulado e proteção contra reabertura duplicada. Testar a interface após publicar; a emissão mensal real segue pendente de validação em homologação.
