# Prévia de fotos e PDFs

## Publicação

1. Faça merge do PR e aguarde o backend no Render. Não há migração nova nesta atualização (a migração de mídia do PR 30 deve estar aplicada).
2. Envie os arquivos do ZIP para a raiz de app.nodusintegracao.com, incluindo attachment-previews.js. Preserve owner. Limpe o cache e recarregue com Ctrl+F5.
3. Mantenha o webhook Evolution configurado em Conexões → Atualizar eventos.

## Uso

- Imagens JPEG/PNG/WebP aparecem em miniatura no balão; clique na foto ou em Ampliar foto para ampliar/baixar.
- PDFs aparecem em um visor dentro do balão, usando o leitor nativo do navegador. Abrir ou baixar PDF abre um visor maior e um link de download. Se o navegador não suportar PDF incorporado, o download continua disponível.
- A prévia funciona para qualquer mensagem que tenha metadados de mídia, recebida ou enviada.
- A Evolution agora registra novos anexos enviados diretamente pelo celular conectado quando entrega o evento messages.upsert/fromMe. Ecos são deduplicados por canal e não disparam automações de entrada. A preferência de grupos continua respeitada.
- Não foi incluído um botão para enviar arquivos pelo app. Envios pela Meta/coexistência só terão prévia se estiverem efetivamente registrados com metadados; esta alteração não implementa importação de ecos da Meta. Arquivos históricos sem metadados não são recuperados retroativamente.

## Proteção e desempenho

As prévias usam o endpoint autenticado de mídia já existente, com isolamento por empresa e limite de 10 MiB por arquivo. Não expõem tokens nem usam serviços públicos de visualização. Os arquivos podem expirar na Evolution/Meta: esta função não é um arquivo permanente.

O navegador carrega anexos próximos da área visível, um por vez, com intervalo entre downloads. Guarda até 40 MiB de arquivos em memória por conversa; o consumo real do navegador pode ser maior ao decodificar imagens/PDFs. Ao trocar de conversa/tela ou sair, cancela a transferência e libera as URLs temporárias. A consulta automática preserva os elementos de prévia e o visor do PDF quando somente o status da mensagem muda. Mensagens e nomes de arquivos continuam escapados.

O visor depende do suporte/configuração do navegador e de eventual CSP da hospedagem permitir imagens blob: e object-src blob:. Não remova proteções globais para liberar outros tipos de objeto. O backend continua enviando os arquivos como download autenticado; o frontend cria URLs temporárias locais após validar o tipo.

## Teste após publicar

1. Envie uma foto e um PDF novos para o WhatsApp conectado; abra a conversa e confira prévia, ampliação e download.
2. Pela Evolution, envie também uma foto/PDF diretamente do celular conectado para esse contato: devem aparecer como OUTBOUND, sem resposta automática.
3. Aguarde várias consultas automáticas: o PDF aberto deve permanecer na página em que você estava.
4. Troque de chat durante o carregamento e saia da sessão: a prévia antiga não deve aparecer em outro chat.
5. Teste no computador e celular. Se o leitor nativo não estiver disponível, use Baixar PDF.

Testes locais: attachment-previews.cjs (carregamento visível, cache, cancelamento, limpeza e limite), auto-refresh.cjs, suítes Jest de conversas/mídia/webhooks e compilação TypeScript. Teste visual em navegador e provedor real continua necessário após publicação.
