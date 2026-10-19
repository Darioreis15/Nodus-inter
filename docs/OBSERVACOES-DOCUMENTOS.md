# Observações internas e documentos

## Publicar
1. Faça merge do PR no GitHub e aguarde o deploy do backend no Render.
2. O comando de inicialização existente `npx prisma migrate deploy && npm run start:prod` aplica a nova tabela de observações. Confirme nos logs que a migração `20261019010000_conversation_notes` concluiu. Não use db push nem execute seed para esta atualização.
3. Depois do backend pronto, envie os arquivos do ZIP para a raiz do app na Hostinger, onde está o index.html de app.nodusintegracao.com. Preserve a pasta owner. Inclua image-viewer.js.
4. Recarregue com Ctrl+F5. Não são necessárias novas variáveis.

## Usar
Abra uma conversa e clique em Observações. Escreva e use Salvar observação interna. O histórico mostra autor e data, com carregamento das anteriores. O texto não é enviado ao WhatsApp, às automações nem ao webhook externo; fica disponível para usuários autenticados da mesma empresa que têm acesso às conversas. Não há edição destrutiva do histórico nesta versão.

Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.ppt/.pptx), OpenDocument, TXT, CSV, RTF, JSON, XML e arquivos compactados são recebidos como documentos com nome e download autenticado. Tipos de documento não reconhecidos são tratados como binários e baixados com extensão .bin. HTML/SVG não são aceitos. Limite de 10 MB por download, sujeito à disponibilidade do provedor. Não há conversão de documentos Office em prévias e nenhum serviço externo recebe os documentos para conversão. Fotos e PDFs continuam com prévia. Esta atualização amplia o RECEBIMENTO; o envio pelo clipe permanece para fotos e PDF.

Ao abrir uma foto, o visualizador ocupa a tela do navegador: scroll, +/−, arraste, pinça no celular, 100%, Ajustar à tela e Baixar. A qualidade depende do arquivo disponível no provedor; ampliar não recupera detalhes perdidos por compressão anterior.

## Privacidade
Observações são excluídas em cascata junto da conversa e incluídas na exportação do contato (notes e notesNextCursor; paginação por notesCursor). Na remoção do autor, seu vínculo é apagado e a interface mostra Usuário removido. A rotina existente de retenção inclui observações segundo MESSAGE_RETENTION_DAYS, respeitando legalHold; não é uma rotina nova executada automaticamente por esta atualização.

## Validar após publicar
- Crie uma observação, feche e abra a conversa. Confira autor/data e ausência de envio ao celular.
- Use outro operador da mesma empresa para consultar; outra empresa deve receber 404.
- Receba um DOCX, XLSX e PPTX novos pela Evolution e confira nome e download. Anexos antigos anteriormente ignorados não são recuperados automaticamente.
- Abra fotos verticais/horizontais, teste zoom, arraste e ajuste à tela; teste pinça no celular.
- Confira exclusão de conversa/contato de teste e retenção em simulação antes de aplicar.

Testes automatizados de escopo das observações, DTO, paginação, formatos de mídia, retenção, migração em PostgreSQL embarcado, zoom e regressões passaram; build TypeScript e sintaxe JavaScript passaram. Validação visual em navegador/celular e recebimento real nos provedores ainda dependem do ambiente publicado. As verificações de assinatura de arquivo não substituem antivírus.
