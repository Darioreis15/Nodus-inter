# Criar o primeiro contrato pelo painel do proprietário

## Publicação
1. Faça merge do PR e aguarde o deploy do backend no Render.
2. Mantenha PLATFORM_OWNER_USER_ID e BILLING_CALENDAR_ENABLED=true no Render, com a configuração Asaas correta para o ambiente usado.
3. Envie a pasta owner deste pacote para a raiz do subdomínio app.nodusintegracao.com, substituindo os arquivos dentro da pasta owner existente. Não coloque o index.html de owner na raiz do app.
4. Acesse https://app.nodusintegracao.com/owner/ e recarregue com Ctrl+F5.
5. O cron do Contabo permanece igual. Esta atualização não exige seed, db push, migration ou novas variáveis.

## Uso
- Empresas SEM assinatura: aparece Criar contrato.
- Contratos encerrados ou empresa suspensa com assinatura: aparece Ativar contrato (reativação).
- Contrato já ativo: não é necessário ativar novamente.

Clique em Criar contrato. O backend apresenta o plano atual, preço mensal e datas previstas. Se quiser outro plano, use Trocar plano antes de abrir o formulário.
Informe CPF/CNPJ e e-mail financeiro do responsável pela cobrança. Confirme sua senha de proprietário e aceite as condições apresentadas. A validação cadastral final é feita pelo Asaas.
Ao concluir, a empresa e o contrato ficam ACTIVE e a tabela é atualizada automaticamente. Isso libera acesso antes do primeiro pagamento, sem registrar qualquer mensalidade como paga.

## Calendário
- Emissão dia 1 e vencimento dia 10, no horário de São Paulo.
- Se criado no dia 1, o contrato começa no mês corrente; o agendador pode emitir ainda nesse dia.
- Se criado depois do dia 1, a primeira mensalidade começa no mês seguinte. Não há cobrança proporcional dos dias anteriores.
- O cadastro cria o cliente no Asaas e uma assinatura local. Não inicia uma segunda recorrência nativa nem emite uma cobrança diretamente nesta requisição.
- O worker/cron existente faz a emissão. Confirme sua execução pelo calendar.log e confira as datas no painel.
- O preço é o preço vigente do plano no banco (inclusive os centavos), não um preço fixado no frontend. O valor confirmado fica registrado no contrato. Trocar posteriormente o plano de acesso não reajusta esse contrato.

## Segurança e falhas
O backend exige JWT, proprietário configurado e senha atual. Há limite de tentativas e auditoria com o autor da criação. Não há segredo, CPF/CNPJ ou senha gravados no JavaScript do pacote.
A criação usa o mesmo bloqueio da empresa usado pelo cadastro de assinatura e mudança de plano. A existência de qualquer assinatura impede novo cadastro. Plano, preço e mês inicial são revalidados sob bloqueio; divergência exige nova confirmação.
Em timeout, atualize a lista antes de repetir. Se o contrato já estiver presente, não tente criar outro. Se a criação do cliente remoto tiver sido concluída mas a transação local falhar, pode existir um cadastro de cliente sem contrato no Asaas; revise esse cadastro antes de repetir. Esse cadastro isolado não emite mensalidade.
Não reative contratos vencidos para contornar inadimplência; o fluxo existente exige regularização no Asaas.

## Endpoints (exclusivos do proprietário)
GET /owner/tenants/:id/contract-preview
Retorna planId, planName, priceCents, startMonth, firstIssueDate e firstDueDate.

POST /owner/tenants/:id/contract
Body: cpfCnpj (11 ou 14 dígitos), email, currentPassword, confirmation="CREATE_CONTRACT", expectedPlanId, expectedPriceCents e expectedStartMonth conforme a prévia.

## Validação
62 testes passaram em 5 suítes (criação, reativação, proprietário, calendário e cobrança); build TypeScript e sintaxe JavaScript passaram.
Nenhum contrato real foi criado durante os testes. Faça a validação funcional com uma empresa de homologação no Asaas Sandbox.
