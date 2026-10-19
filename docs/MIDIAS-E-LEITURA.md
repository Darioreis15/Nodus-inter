# Fotos, PDFs e confirmação de leitura

## Publicação

1. Faça merge do PR e aguarde o deploy no Render. O comando existente `npx prisma migrate deploy && npm run start:prod` aplica a coluna de mídia; não precisa de seed nem db push.
2. Envie os arquivos do frontend atualizado para a raiz do subdomínio do app na Hostinger. Preserve a pasta owner. Recarregue com Ctrl+F5.
3. Como administrador, abra Conexões e clique em **Atualizar eventos** em cada canal Evolution existente. Isso configura recebimento, entrega, leitura e conexão com o token de webhook do backend. Não exige excluir o canal nem reconectar o celular. Novos canais já recebem esses eventos.
4. Envie uma foto JPEG/PNG/WebP e um PDF novos, de outro WhatsApp para o número conectado. Abra a conversa no app: a foto abre em uma janela e o PDF pode ser baixado. Ambos exigem sessão válida e pertencimento à empresa.
5. Envie uma resposta pelo app, leia no celular destinatário e aguarde a atualização da conversa (até cerca de 30 segundos). Enviada, Entregue e Lida são estados diferentes; Lida usa dois tiques azuis apenas após confirmação do provedor. Confirmações desativadas no WhatsApp podem impedir esse retorno.
6. Na Meta, mantenha a assinatura do webhook messages e um token válido. Faça os mesmos testes com uma conta apta a enviar mensagens; esta atualização não remove restrições impostas pela Meta.

## Funcionamento e limites

- Recebimento de JPEG, PNG, WebP e PDF, até 10 MiB por arquivo. Esta entrega não inclui envio de anexos pelo app.
- A mensagem guarda metadados. O arquivo é recuperado da Evolution/Meta quando o operador abre ou baixa, sem armazenar binários no PostgreSQL ou depender do disco temporário do Render. Não é um arquivo permanente: mídias podem expirar no provedor. Na Evolution, a mensagem original precisa continuar disponível na base da instância.
- Mensagens antigas que foram salvas sem referência de mídia não ganham anexos retroativamente. Mídias de visualização única não são convertidas em anexos permanentes.
- Downloads exigem JWT e isolamento por empresa, com limite de tamanho durante a transferência, verificação de assinatura do formato e limites de concorrência/requisições. A conferência do formato não é um antivírus.
- IDs privados de mídia e tokens dos provedores não aparecem nas respostas de listagem. URLs recebidas de webhooks não são usadas como destinos arbitrários de download.
- Eventos atrasados não rebaixam uma mensagem Lida para Enviada/Entregue. A confirmação depende do evento real do WhatsApp, não de abrir a conversa no Nodus.
- Se um evento de status chegar antes de o envio ser salvo no banco, ele pode não encontrar a mensagem; não há fila persistente de comprovantes nesta entrega.

## Referências dos provedores

- Evolution: https://docs.evoapicloud.com/api-reference/chat-controller/get-base64
- Meta: https://www.postman.com/meta/whatsapp-business-platform/request/fpj02x0/retrieve-media-url
