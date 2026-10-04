# Nodus — atualização do painel do cliente

Esta entrega altera **backend e frontend**. Substituir somente o HTML/JS não habilita as novas rotas. Nada foi aplicado ao banco do Render nem enviado para WhatsApp durante a preparação.

## O que foi implementado

- **Conexões**: criar e listar canais sem F5, consultar telefone/estado, obter QR Code, reiniciar a conexão Evolution, desconectar e excluir canal (ADMIN). Cadastro oficial Meta por Phone Number ID/token e atualização segura do token.
- **Conversas**: iniciar por canal/telefone, enviar texto, enviar template Meta aprovado com parâmetros de texto no corpo, editar nome, excluir conversa Evolution e seu histórico local. Nomes de perfil passam a ser gravados quando o contato ainda não tem nome. Nomes já editados são preservados. Grupos não recebem o nome de um participante.
- **Operadores**: senha temporária opcional definida pelo administrador ou gerada pelo servidor, exibida uma única vez. Troca obrigatória no primeiro login. Disponibilidade manual e por horário/dias.
- **Acesso**: e-mails normalizados com trim/lowercase no cadastro e login, recuperação por e-mail Resend, link de 15 minutos/uso único, hash do token no banco e revogação das sessões após redefinir senha.
- **Configurações**: expediente, fuso, mensagem fora de horário, etapas de funil e criação/revogação de API keys.
- **Funil**: classificação por etapa; palavra-chave exata, sem diferenciar maiúsculas/minúsculas, pode mudar etapa, enviar resposta e atribuir operador disponível. Sem operador disponível, a conversa fica na fila. Mover manualmente não envia mensagens. Resposta fora do horário é enviada ao iniciar uma conversa; não se repete em toda mensagem.
- **Mensalidades**: consulta paginada das cobranças vinculadas ao cliente Asaas da empresa, inclusive avulsas criadas para aquele mesmo cadastro, estado, valores, vencimentos e links de pagamento. Contagem de pagas/confirmadas indica explicitamente o subconjunto carregado; carregue as demais páginas para consultar todo o histórico. Cobranças criadas para outro cliente Asaas não aparecem.
- **Logs**: nome e horário de quem finalizou, independente do operador atribuído. Registros anteriores não têm o nome retroativamente inventado.
- **Sessão**: JWT fica em memória, não em localStorage. Recarregar/fechar exige novo login. Sair revoga as sessões do usuário. Mensagens da conversa aberta são consultadas a cada 30 segundos somente com a aba visível; listas têm atualização manual.

## Publicar o backend primeiro

1. Revise e incorpore a branch/PR no repositório. Se usar o ZIP, a pasta `backend/` contém o código completo desta versão. Não substitua seu `.env` nem envie segredos para o Git.
2. Mantenha o build do Render:
   ```sh
   npm ci --include=dev && npx prisma generate && npm run build
   ```
3. Mantenha o start:
   ```sh
   npx prisma migrate deploy && npm run start:prod
   ```
4. Esta versão inclui `20261003040000_customer_workspace`. **Não use db push no lugar dessa migração**: ela normaliza os e-mails existentes e cria o índice que impede duplicidades por capitalização. Se existirem duas contas que só diferem por maiúsculas/espaços, a migração interrompe com mensagem explícita; resolva as identidades antes de repetir. Não apague usuários automaticamente.
5. Mantenha as variáveis de segurança e dos provedores já configuradas. Acrescente ao Render:
   ```dotenv
   FRONTEND_URL=https://app.nodusintegracao.com
   RESEND_API_KEY=CHAVE_DO_SERVICO_RESEND
   MAIL_FROM=Nodus <acesso@nodusintegracao.com>
   ```
   `FRONTEND_URL` deve ser a origem HTTPS real do painel, sem caminho. O remetente precisa pertencer a um domínio verificado no Resend. Configure os registros DNS solicitados pelo serviço. Sem esses dados, a recuperação mostra que o envio ainda não está configurado; não finge que enviou. Nenhuma destas credenciais vai no frontend.
6. Em `CORS_ORIGINS`, inclua a origem HTTPS real do painel. Exemplo: `https://app.nodusintegracao.com`. Preserve outras origens reais necessárias, separadas por vírgula. Não use `*` nem URLs com caminho.

## Publicar o frontend

1. Na hospedagem do **subdomínio do sistema**, envie o conteúdo de `app/` do ZIP (ou `frontend/` do repositório): `index.html`, `app.js`, `style.css`, `pages.css`, `favicon.svg`, `logo-nodus-mark.svg`.
2. O `index.html` já aponta `NODUS_API_URL` para `https://nodus-inter.onrender.com`. Não coloque API keys, JWT_SECRET ou tokens Meta/Evolution no HTML.
3. A pasta `institucional/` foi preservada do ZIP original; não é necessário republicá-la para atualizar o painel.
4. Abra a URL HTTPS do painel e faça login. Na primeira abertura após publicação, se o navegador tiver os arquivos antigos em cache, use Ctrl+F5. Criar canais depois disso atualiza a lista sem recarregar.
5. A migração permite ADMIN de empresa suspensa fazer login para ver o financeiro. `/auth/me`, alteração de senha/logout e rotas financeiras permitidas permanecem acessíveis; conversas, canais e demais operações continuam bloqueadas no servidor. AGENT suspenso continua sem login.

## Homologação com os seus provedores

Os testes locais usaram banco descartável e APIs simuladas. Valide estas ações em homologação após o deploy:

1. Entrar com o e-mail em maiúsculas; criar operador com senha temporária e trocar no primeiro login.
2. Solicitar recuperação, receber e-mail e redefinir. Reutilizar o link deve falhar. Não compartilhe o link/token.
3. Criar dois canais em sequência sem F5. Em um canal Evolution de teste, consultar conexão, reconectar, desconectar e ler novo QR Code.
4. Conferir o telefone conectado. A consulta usa `instance/fetchInstances`; a versão instalada da Evolution precisa oferecer as rotas indicadas abaixo. O painel gerencia **os canais da plataforma**, não todos os aparelhos vinculados à conta WhatsApp.
5. Enviar mensagem real de um contato de teste e confirmar nome. Iniciar uma conversa pelo botão “Nova conversa”. Excluir somente uma conversa descartável. A exclusão é **local**: não promete apagar cópias do WhatsApp, backups ou sistemas externos. Canal sob preservação legal não pode ser apagado. Se a exclusão da instância Evolution falhar, o canal local é preservado para nova tentativa.
6. Configurar uma etapa, palavra-chave e operador. Testar com disponibilidade ativa/inativa e fora do expediente. O funil é de atendimento por eventos de entrada; **não é uma campanha de disparo em massa ou uma sequência de follow-ups agendados**.
7. Finalizar como um usuário diferente do responsável e conferir o nome nos logs.
8. Consultar cobranças Asaas e comparar com o mesmo cliente no painel Sandbox. Esta tela consulta cobranças, não cria pagamentos ou movimenta valores.
9. Criar uma API key, testar em integração de homologação e revogar.

## Meta oficial e coexistência

Coexistência permite manter o aplicativo WhatsApp Business e usar a Cloud API no mesmo número. Não é trocar a URL da API ou remover a restrição 130497. É um onboarding específico pelo Embedded Signup, sujeito à elegibilidade da conta/número e à configuração/permissões do aplicativo Meta.

O cadastro manual de canal oficial já está implementado, mas **onboarding por coexistência e sincronização de mensagens enviadas pelo celular (`smb_message_echoes`) não foram habilitados**. Não registre/migre seu número atual pelo fluxo convencional supondo que isso ativa coexistência. Primeiro confirme no aplicativo Meta a disponibilidade do fluxo e os requisitos de Tech Provider/Solution Partner. Depois será necessário implementar o callback seguro, vínculo dos ativos à empresa, troca do código no servidor e processamento dos eventos de sincronização. Não foi possível validar isso na sua conta sem acesso ao painel/ativos elegíveis.

Para iniciar mensagem pela API oficial fora da janela de atendimento, use “Template” na conversa. A primeira versão aceita templates aprovados sem mídia/botões e com parâmetros textuais no corpo; a Meta valida nome, idioma e parâmetros. `SENT` significa aceitação pelo provedor; a entrega depende de `DELIVERED`/`READ`. Restrição de conta/país permanece sob controle da Meta.

Documentação consultada:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- https://docs.evolutionfoundation.com.br/evolution-api/logout-instance (DELETE `/instance/logout/{instanceName}`; reinício POST `/instance/restart/{instanceName}` conforme versão atual)
- https://docs.asaas.com/reference/listar-cobrancas
- https://resend.com/docs/api-reference/emails/send-email

## Verificações executadas

- Compilação TypeScript/Nest.
- 146 testes em 17 suítes: autenticação, autorização real de rotas, isolamento de tenant, horários/roteamento, recuperação, preservação legal, financeiro e regressões existentes.
- Migrações aplicadas em PostgreSQL/WASM descartável (PGlite): e-mails normalizados, índice sem diferenciar caixa, tabelas novas e interrupção segura diante de contas duplicadas.
- Smoke test Chromium desktop/celular com domínio reservado `api.nodus.test`: criação consecutiva sem reload, login, XSS como texto, QR inválido, senha temporária/troca, configurações, logs, cobranças, sessão vencida, navegação de operador e admin suspenso. Toda rede externa bloqueada.
- Não houve deploy automático nem execução contra o banco/provedores do usuário. Proxy/IP no Render permanece pendente da confirmação de infraestrutura já discutida.

Os testes adicionais podem ser repetidos com Playwright e PGlite em ambiente de desenvolvimento; scripts em `tests/`. Essas ferramentas de QA não são dependências de produção.

## Convite do operador por e-mail

Novos cadastros em POST /users enviam o acesso pelo Resend usando as mesmas variáveis da recuperação. A senha escolhida ou gerada é enviada em texto no e-mail; somente o hash fica no banco, e a troca no primeiro acesso continua obrigatória. O envio não é retroativo. A senha temporária não tem prazo de expiração automático nesta versão.

A resposta inclui invitationEmailStatus: accepted (aceito pelo provedor, não comprova entrega), failed ou not_configured. Falha de envio não desfaz o usuário nem exige recadastro. O administrador pode copiar a senha exibida uma vez ou orientar o uso de Esqueci minha senha. Não há repetição automática do envio.

Publique o backend e substitua frontend/app.js e frontend/index.html na hospedagem do painel. Não há migração nem variável nova. Testes usam fetch simulado e não enviam e-mail real.

## Exclusão de operadores e limite do plano

ADMIN pode excluir AGENT da própria empresa em DELETE /users/:id, com confirmação no painel. Não permite excluir administradores nem o próprio acesso. A exclusão libera uma vaga; o limite maxUsers conta administradores e operadores. GET /users/limits (ADMIN) retorna uso, limite e vagas disponíveis. Cadastro/exclusão usam transação com trava na empresa para serializar mudanças de vagas e impedir cadastros concorrentes acima do limite.

Conversas, mensagens, nomes de finalizadores e auditoria são preservados. Atribuições são removidas e etapas de funil deixam de apontar para o operador excluído. Tokens de recuperação são apagados por cascade; JWTs antigos são recusados na próxima requisição porque o usuário não existe mais. Sem migração. Atualizar frontend/app.js e frontend/index.html após deploy.
