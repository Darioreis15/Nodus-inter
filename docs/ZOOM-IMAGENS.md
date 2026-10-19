# Visualizador de imagens

Clique na miniatura ou em Ampliar foto. A imagem abre em um visualizador que ocupa a janela inteira, independente das janelas menores de formulários.

- Scroll ou +/−: ampliar/reduzir, até 800%.
- Arraste: navegar pela imagem ampliada.
- Duplo clique: alternar entre ajuste à tela e ampliação.
- Celular: gesto de pinça e arraste com o dedo.
- 100%: tamanho natural (um pixel da imagem por pixel CSS).
- Ajustar à tela: ver a imagem completa, mantendo proporção e sem cortes.
- Baixar: salvar o arquivo recebido.
- Esc ou ✕: fechar. Teclado: +/−, 0 (ajustar), 1 (100%) e setas (mover).

O visualizador usa o mesmo Blob autenticado do anexo, sem criar miniatura reduzida, recomprimir ou enviar a terceiros. Não recupera detalhes que já tenham sido perdidos na compressão realizada antes do recebimento pelo Nodus. As URLs temporárias são liberadas ao fechar/remover a janela ou sair da sessão.

## Publicar

Substitua os arquivos do frontend na raiz de app.nodusintegracao.com, incluindo image-viewer.js; preserve owner. Limpe o cache e recarregue com Ctrl+F5. Alteração apenas de frontend, sem migração ou variável nova. Requer a versão de anexos do PR32.

## Validação

Testes locais de ajuste horizontal/vertical, limites do arraste, zoom no ponto do cursor, redimensionamento, cache de anexos e atualização automática passaram. Sintaxe JS e diff verificados. Sem navegador Chromium disponível nesta execução: validar aparência e gestos após publicação em desktop e celular, com uma imagem grande e outra vertical. Confira que a atualização do chat não fecha o visualizador e que Esc/Sair fecha e libera a imagem.
