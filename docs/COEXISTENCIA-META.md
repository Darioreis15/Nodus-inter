# Coexistência da Meta — viabilidade e validação

É viável permitir que uma empresa mantenha o mesmo número no WhatsApp Business do celular e na Cloud API. Não é uma API substituta: o onboarding habilita a coexistência para um número elegível. Há fornecedores que já oferecem isso; o diferencial do Nodus será a experiência integrada, não a exclusividade da funcionalidade.

A documentação da Meta exige atuação como Solution Partner ou Tech Provider e WhatsApp Business compatível. O caminho é Embedded Signup configurado para Business app onboarding. Referências oficiais consultadas em 04/10/2026:

- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers

## Situação desta entrega

O Nodus continua usando o conector oficial existente. **Não implementamos nem declaramos validado o onboarding de coexistência nesta atualização.** A conta Meta anteriormente restringida continua sendo uma dependência externa. Alterar o cadastro do canal ou colar outro token não libera uma restrição.

## Próxima implementação proposta

1. Confirmar no painel Meta a elegibilidade do negócio, do aplicativo e do número. Concluir as verificações solicitadas no onboarding de Tech Provider; não prometer aprovação enquanto houver restrição ou documentação pendente.
2. Configurar e integrar Embedded Signup no frontend, com troca de código por token no backend, vinculação ao tenant autenticado e proteção contra associação de número de outra empresa.
3. Acrescentar processamento dos eventos de coexistência: mensagens enviadas pelo celular, sincronização de contatos e histórico autorizado. Impedir que ecos ou mensagens históricas disparem o robô/follow-up como se fossem respostas novas.
4. Tratar desconexão/reconexão e revogação de acesso. Só apresentar a opção como operacional depois desses fluxos passarem no teste real.

## Roteiro de aceitação

Use um número de teste sob seu controle, com WhatsApp Business instalado e acesso ao aparelho e às verificações. Não use o número principal de atendimento no primeiro teste.

- Complete o onboarding oficial e confirme que o aplicativo continua utilizável no celular.
- De outro telefone, envie uma mensagem ao número conectado. Deve aparecer uma vez no Nodus e no celular.
- Responda pelo Nodus e confirme a entrega no destinatário e a sincronização esperada no aplicativo.
- Responda pelo celular e confirme que aparece como saída no Nodus, sem disparar resposta automática a si próprio.
- Teste histórico/contatos autorizados sem mensagens duplicadas e sem disparar campanhas antigas.
- Teste template, status de entrega, reconexão e revogação de acesso.
- Teste o isolamento entre duas empresas; uma não pode visualizar, vincular ou enviar pelo número da outra.

Esses são critérios de teste propostos para a futura integração. Aprovação da conta, requisitos e interfaces da Meta precisam ser conferidos novamente na execução. Até a entrega real e a sincronização passarem, mantenha o recurso marcado como pendente.
