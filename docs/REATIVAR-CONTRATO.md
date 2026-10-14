# Ativar contrato pelo proprietário

Requer o backend do calendário (PR #26) e BILLING_CALENDAR_ENABLED=true, com agendador configurado.

1. Integre este PR e publique o backend. Ele inclui os commits do #26 caso ainda não estejam na main. Mantenha prisma migrate deploy no deploy; não há migração adicional além da do calendário.
2. Atualize os três arquivos dentro da pasta owner da Hostinger. Não copie owner/index.html para a raiz do aplicativo.
3. Acesse /owner/, busque a empresa e clique Ativar contrato. O botão aparece se houver assinatura e ela não estiver ativa ou se a empresa estiver suspensa.
4. Leia a confirmação e informe sua senha. A permissão continua exclusiva do usuário configurado em PLATFORM_OWNER_USER_ID.

Resultado: tenant e contrato ACTIVE, acesso liberado, data de cancelamento removida e próximas cobranças agendadas para dia 1/vencimento dia 10. Mantém valor contratado e cobranças antigas. Não emite cobrança na hora, não marca boleto como pago e não retoma campanhas canceladas. A auditoria mantém o registro de cancelamento anterior e registra quem reativou.

A próxima emissão respeita o mês inicial anterior, os meses já cobrados e os ciclos anteriores. Não reabre ciclos cancelados. Se ativar após dia 1, o novo início será, no mínimo, o mês seguinte.

Bloqueios:
- Cancelamento pendente: concluir a confirmação de cancelamento primeiro.
- Emissão SENDING: conciliar a tentativa incerta primeiro.
- Cobrança vencida do contrato: regularizar no Asaas; não há perdão automático de dívida.
- Contrato nativo com cartão recorrente, split ou condições especiais: revisão necessária antes de conversão.
- Empresa sem assinatura: cadastrar o contrato de cobrança antes; o botão não cria cadastro financeiro sem CPF/CNPJ.
- Calendário desligado: ativá-lo/configurar o agendador antes para não liberar contrato sem recorrência.

A recorrência nativa do Asaas permanece INACTIVE: as próximas emissões são feitas pela Nodus. Se a API do Asaas falhar, o acesso não é liberado; é possível repetir a ativação com segurança após conferir o erro. A operação pode levar alguns segundos para conferir cobranças.

POST /owner/tenants/:id/activate
Authorization: Bearer JWT_DO_PROPRIETARIO
Body: {"currentPassword":"SUA_SENHA","confirmation":"ACTIVATE"}

Testes: 56 testes de ativação, calendário, cancelamento e autorização passaram. Build e sintaxe JS passaram. Nenhum contrato real foi ativado durante o desenvolvimento. Validar interface e uma reativação de teste no Sandbox após publicar.
