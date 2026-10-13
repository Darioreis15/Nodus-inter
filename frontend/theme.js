/* Applied synchronously before styles to avoid a flash of the wrong theme. */
(() => {
  'use strict';
  const key = 'nodus_theme';
  const valid = value => ['dark', 'light', 'system'].includes(value);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'dark';
  try { const saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch { /* Session-only when storage is blocked. */ }
  function apply() {
    const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'light' ? '#f4f3ef' : '#0F1C29';
    document.querySelectorAll('input[name="appearance-theme"]').forEach(input => { input.checked = input.value === preference; });
    window.dispatchEvent(new CustomEvent('nodus:theme-change', { detail: { preference, resolved } }));
  }
  window.NodusTheme = Object.freeze({
    getPreference: () => preference,
    setPreference(value) {
      if (!valid(value)) return false;
      preference = value;
      let saved = true;
      try { localStorage.setItem(key, value); } catch { saved = false; }
      apply();
      return saved;
    },
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = valid(event.newValue) ? event.newValue : 'dark';
      apply();
    }
  });
  apply();
})();
