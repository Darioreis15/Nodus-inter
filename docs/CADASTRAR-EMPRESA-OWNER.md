# Cadastrar empresas pelo painel do proprietário

## Publicar
1. Faça merge do PR no GitHub e aguarde o deploy do backend no Render.
2. Envie a pasta owner deste ZIP para a raiz do subdomínio app.nodusintegracao.com, substituindo os arquivos da pasta owner existente. Não substitua o index.html principal do aplicativo pelo index.html do painel.
3. Acesse https://app.nodusintegracao.com/owner/ e atualize com Ctrl+F5.
4. Nenhuma nova variável, migration, seed, db push ou alteração no cron é necessária.

## Cadastrar
Clique em + Cadastrar empresa e informe:
- Nome da empresa.
- Plano de acesso (com os limites e preço do catálogo apresentados).
- Nome e e-mail do administrador principal.
- Senha temporária opcional (mínimo 12 caracteres, máximo 72 bytes UTF-8). Em branco, o sistema gera uma senha segura.
- Se deseja enviar o acesso por e-mail.
- Sua senha atual de proprietário para confirmar a operação.

O administrador principal será ADMIN, isOwner=true e deverá trocar a senha no primeiro login. Essa conta não pode ser excluída ou ter sua função alterada pelas rotas de operadores. Ela pode atualizar seus próprios dados pelas configurações de conta já existentes. O primeiro administrador ocupa uma vaga do limite de usuários do plano.

O e-mail é normalizado para minúsculas e não pode pertencer a outra conta. Não existe login cruzado de empresas usando o mesmo e-mail nesta versão. Empresas com nomes iguais recebem identificadores distintos.

Ao concluir, o painel mostra a empresa cadastrada, o e-mail e a senha temporária (oculta inicialmente, com opção Mostrar/Copiar). A lista é atualizada e filtrada pelo identificador da nova empresa. Limpe a busca para voltar a todas as empresas.
A senha em texto só é retornada na confirmação inicial, não é persistida pelo frontend nem gravada no banco em texto puro. Fechar a confirmação ou sair do painel limpa os campos. Se perder o acesso, use Esqueci minha senha.

## Convite por e-mail
Reutiliza o envio de convites existente: RESEND_API_KEY, MAIL_FROM e FRONTEND_URL (https://app.nodusintegracao.com).
- accepted: o provedor aceitou a mensagem; isso não garante entrega na caixa de entrada.
- failed: empresa criada, envio falhou. Repasse o acesso por canal privado ou utilize a recuperação de senha.
- not_configured: envio não configurado.
- not_requested: envio desmarcado no cadastro.
O convite só é enviado após a transação de cadastro concluir. Não recadastre uma empresa só porque o e-mail não chegou.

## Contrato e acesso
Assim como o cadastro existente, a empresa fica ACTIVE. O cadastro libera acesso com os limites do plano, mas NÃO cria assinatura nem emite cobrança.
Após salvar, clique em Criar contrato na confirmação, ou na linha da empresa, para preencher CPF/CNPJ e e-mail financeiro e confirmar o calendário mensal. A criação do contrato continua exigindo sua senha e confirmação do preço/datas.
O e-mail financeiro pode ser diferente do e-mail do administrador. Se quiser cadastrar apenas para demonstração, conclua sem criar contrato.

## Segurança
POST /owner/tenants é exclusivo de PLATFORM_OWNER_USER_ID; exige JWT, permissão do proprietário, senha atual e confirmation=CREATE_COMPANY. Reutiliza o limite de mutações do painel.
A empresa, administrador e auditoria são gravados na mesma transação. O plano é verificado no servidor. O backend revalida o proprietário e a versão de sessão antes da gravação. Respostas não incluem hash de senha ou configurações internas.
Submissões repetidas com o mesmo e-mail são bloqueadas pela unicidade no banco. Se a resposta se perder, atualize a lista antes de tentar novamente; uma empresa já criada não deve ser duplicada.

Body da API: companyName, adminName, adminEmail, planId, temporaryPassword (opcional), sendInvitation (boolean), currentPassword, confirmation="CREATE_COMPANY".

## Validação
Testes de criação, autorização, convites existentes, login/conta e criação de contratos; build TypeScript, sintaxe JavaScript e diff verificados. Nenhuma empresa real foi cadastrada e nenhum convite real foi enviado nos testes. A validação visual final deve ser feita após publicar na Hostinger (Chromium não disponível neste ambiente).
