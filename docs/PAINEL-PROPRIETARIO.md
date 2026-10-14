# Painel privado do proprietário Nodus

Implementação em cima do PR #24 (encerramento de contrato). Integre o PR #24 antes deste, ou integre este PR que já contém os mesmos commits. Não precisa aplicar os dois separadamente se o GitHub já identificar o #24 como integrado.

## Instalação
1. Publique o backend deste PR. Mantenha `npx prisma migrate deploy && npm run start:prod` para aplicar também a migração de cancelamento do #24. Não use db push em substituição às migrações.
2. Entre com SUA conta ADMIN no aplicativo. Consulte GET /auth/me com o JWT dessa conta e copie `user.id` (não `tenant.id`). Essa consulta inicial é a única configuração manual necessária.
3. No Render > Environment, crie `PLATFORM_OWNER_USER_ID` com esse UUID, sem aspas. Salve e faça deploy/restart. Não coloque o valor no frontend nem no Git. Vazio desativa o painel para todos. Administradores de clientes e proprietários de empresas NÃO recebem acesso global.
4. No gerenciador de arquivos Hostinger, abra a raiz do subdomínio app.nodusintegracao.com. Envie a pasta `owner` contida no ZIP: devem existir owner/index.html, owner/owner.js e owner/owner.css. Não substitua o index.html principal do app. Se houver regra de SPA capturando todos os caminhos, preserve arquivos e diretórios existentes antes do fallback.
5. Abra https://app.nodusintegracao.com/owner/ e entre com sua conta. A URL da API está em owner.js; é pública e não é segredo. CORS_ORIGINS deve continuar incluindo https://app.nodusintegracao.com (origem, sem /owner). Não precisa de domínio novo.
6. Verifique uma empresa de homologação. Troque um plano, confirme os limites no app e, somente em contrato de teste, valide o cancelamento. O deploy não altera empresas automaticamente.

## O que o painel faz
- Resumo de empresas ativas/suspensas e cancelamentos pendentes.
- Pesquisa por nome/slug, filtro de situação, paginação de 25 empresas.
- Mostra plano, preço DE CATÁLOGO, uso de canais/usuários e estado da assinatura.
- Troca plano DE ACESSO, com senha e confirmação explícita. Não muda a recorrência nem boletos existentes no Asaas. Uma futura assinatura nova usa o preço vigente do plano; não use a troca como reajuste financeiro. Para reajustar contratos existentes, esta versão ainda exige gestão separada no Asaas.
- Recusa downgrade que ultrapasse limites, contrato encerrado e atualização baseada em plano desatualizado. Usa bloqueio de empresa compatível com criação de usuários e canais.
- Encerra contrato imediatamente: suspende acesso, cancela campanhas/entregas enfileiradas e solicita status INACTIVE na recorrência Asaas, preservando cobranças/histórico. Sem estorno. Empresa sem assinatura não apresenta botão de encerramento.
- Se o Asaas falhar, a suspensão local permanece; aparece cancelamento pendente. Atualize a lista e clique Repetir cancelamento com a mesma empresa. Não há retry automático. Não reabre contrato cancelado.
- Registra ator e empresa no audit log; troca de plano registra IDs anterior/novo. Retenção de auditoria segue a configuração existente.

## Segurança e limites
Backend exige JWT válido, conta ADMIN atual, senha inicial já trocada e ID exato configurado. JWT continua sujeito a expiração/revogação. Ter isOwner no tenant não concede acesso global. Não é autenticação multifator; proteger o e-mail e a senha do proprietário continua essencial.

Todas as alterações pedem a senha atual. Limite adicional de 10 mutações por 15 minutos por proprietário, além dos limites existentes. Segredos, configuração de canais e hashes de senha não são retornados pela listagem. Token de sessão apenas em memória: recarregar pede login novamente. Sair remove a sessão do painel; revogar todas as sessões continua disponível no app.

O HTML da tela de login pode ser público. A privacidade dos dados é aplicada no servidor; URL escondida e noindex não são controle de acesso. A conta configurada continua com acesso ao painel mesmo se sua própria empresa estiver suspensa. Remover a variável revoga o privilégio global após restart.

Não envia mensagens, não cria cobrança e não cancela nenhum contrato apenas ao publicar. Não substitui obrigações de retenção nem interrompe envios já em processamento. A instância WhatsApp não é apagada pelo encerramento.

## Rotas (JWT do proprietário)
GET /owner/me
GET /owner/summary
GET /owner/plans
GET /owner/tenants?search=texto&status=ACTIVE&cursor=UUID
PATCH /owner/tenants/:id/plan
  {"planId":"UUID","expectedPlanId":"UUID_ATUAL","currentPassword":"SUA_SENHA","confirmation":"ACCESS_ONLY"}
POST /owner/tenants/:id/cancel
  {"currentPassword":"SUA_SENHA","confirmation":"CANCEL"}

401 = sessão inválida/expirada. 403 = conta não autorizada ou senha incorreta. 409 = conflito/limites. 429 = limite de tentativas. 503 CANCELLATION_PENDING = acesso suspenso, confirmação remota pendente.

## Verificação
Testes automatizados de isolamento proprietário/clientes, senha, bloqueio de downgrade, concorrência por plano esperado, auditoria e cancelamento. Validar em homologação após configurar seu ID: administrador de outra empresa recebe 403 em TODAS as rotas /owner; AGENT também; sem JWT recebe 401.
