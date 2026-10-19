// Session-only media cache. Never put attachments or bearer tokens in storage.
export function createAttachmentPreviews({ load, maxBytes = 40 * 1024 * 1024 }) {
  let generation = 0, bytes = 0, running = false, controller, observer;
  const cache = new Map(), queue = [], pending = new Set();
  function show(element, entry) {
    if (!element.isConnected) return;
    element.replaceChildren();
    if (entry.blob.type.startsWith('image/')) {
      const img = document.createElement('img'); img.src = entry.url; img.alt = 'Imagem da conversa';
      img.decoding = 'async'; img.style.cursor = 'zoom-in'; img.onclick = () => element.parentElement.querySelector('[data-media-id]')?.click(); element.append(img);
    } else {
      const pdf = document.createElement('object'); pdf.type = 'application/pdf';
      pdf.data = `${entry.url}#page=1&view=FitH&toolbar=0`; pdf.setAttribute('aria-label', 'Prévia do PDF');
      const fallback = document.createElement('p'); fallback.textContent = 'Prévia indisponível neste navegador. Use Abrir ou Baixar PDF.';
      pdf.append(fallback); element.append(pdf);
    }
    element.dataset.loaded = 'true';
  }
  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const { id, element, version } = queue.shift();
      if (version !== generation || !element.isConnected) { pending.delete(id); continue; }
      controller = new AbortController();
      try {
        if (bytes >= maxBytes) throw new Error('Limite de prévias desta conversa. Use Abrir ou Baixar.');
        const blob = await load(id, controller.signal);
        if (version !== generation) continue;
        if (bytes + blob.size > maxBytes) throw new Error('Limite de prévias desta conversa. Use Abrir ou Baixar.');
        const entry = { blob, url: URL.createObjectURL(blob) }; bytes += blob.size; cache.set(id, entry); show(element, entry);
      } catch (error) {
        if (version === generation && element.isConnected) element.textContent = error.message || 'Não foi possível carregar a prévia. Use Abrir ou Baixar.';
      } finally { if (version === generation) pending.delete(id); }
      // Respect the existing 30 downloads/minute budget; only one automatic download at a time.
      await new Promise(resolve => setTimeout(resolve, 2200));
    }
    running = false;
  }
  return {
    get(id) { return cache.get(id)?.blob; },
    observe(root) {
      observer?.disconnect();
      const enqueue = element => {
        const id = element.dataset.previewId;
        if (cache.has(id)) return show(element, cache.get(id));
        if (pending.has(id) || element.dataset.attempted) return;
        element.dataset.attempted = 'true'; pending.add(id); queue.push({id, element, version:generation}); pump();
      };
      const items = [...root.querySelectorAll('[data-preview-id]:not([data-loaded])')];
      if (typeof IntersectionObserver === 'undefined') { items.slice(-3).forEach(enqueue); return; }
      observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { observer.unobserve(e.target); enqueue(e.target); } }), {root, rootMargin:'80px'});
      items.forEach(element => observer.observe(element));
    },
    clear() {
      generation++; controller?.abort(); observer?.disconnect(); queue.length = 0; pending.clear();
      for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
      cache.clear(); bytes = 0;
    },
  };
}
