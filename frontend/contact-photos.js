// Session-only photo cache; no localStorage, cookies, or provider credentials.
export function createContactPhotos(fetchPhoto) {
  let epoch = 0, active = 0;
  const cache = new Map(), queue = [], controllers = new Set(), observed = new Set();
  const safeUrl = value => {
    try {
      if (typeof value !== 'string' || value.length > 2048) return null;
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
        (u.hostname === 'whatsapp.net' || u.hostname.endsWith('.whatsapp.net')) ? u.href : null;
    } catch { return null; }
  };
  function drain() {
    while (active < 3 && queue.length) {
      const job = queue.shift();
      if (job.epoch !== epoch) { job.resolve(null); continue; }
      active++;
      const controller = new AbortController(); controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 8000);
      Promise.resolve().then(() => fetchPhoto(job.id, controller.signal)).then(safeUrl).catch(() => null)
        .then(url => job.resolve(job.epoch === epoch ? url : null))
        .finally(() => { clearTimeout(timeout); controllers.delete(controller); active--; drain(); });
    }
  }
  function get(id) {
    const hit = cache.get(id);
    if (hit && hit.expires > Date.now()) return hit.promise;
    cache.delete(id);
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    const promise = new Promise(resolve => queue.push({ id, resolve, epoch }));
    cache.set(id, { promise, expires: Date.now() + 60000 });
    drain(); return promise;
  }
  async function paint(el) {
    const version = epoch, id = el.dataset.contactPhoto;
    const url = await get(id);
    if (!url || version !== epoch || !el.isConnected || el.dataset.contactPhoto !== id) return;
    const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
    img.onerror = () => img.remove();
    el.querySelector('img')?.remove(); el.append(img); img.src = url;
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target); observed.delete(entry.target); paint(entry.target);
    }
  }, { rootMargin: '50px' });
  return {
    observe(root) {
      for (const el of observed) if (!el.isConnected) { observer.unobserve(el); observed.delete(el); }
      root.querySelectorAll('[data-contact-photo]').forEach(el => { observed.add(el); observer.observe(el); });
    },
    clear() {
      epoch++; observer.disconnect(); observed.clear(); cache.clear();
      queue.splice(0).forEach(job => job.resolve(null));
      controllers.forEach(controller => controller.abort());
      document.querySelectorAll('[data-contact-photo] img').forEach(img => img.remove());
    },
  };
}
