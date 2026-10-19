// Merge the current first page without discarding older pages loaded by the user.
export function mergeRecent(previous, recent, pageSize, timestamp) {
  const compare = (a, b) => (Date.parse(timestamp(b)) || 0) - (Date.parse(timestamp(a)) || 0) || String(b.id).localeCompare(String(a.id));
  const fresh = [...recent].sort(compare);
  if (fresh.length < pageSize) return fresh;
  const ids = new Set(fresh.map(row => row.id));
  const boundary = fresh.at(-1);
  return [...fresh, ...previous.filter(row => !ids.has(row.id) && compare(row, boundary) > 0)].sort(compare);
}

export function createAutoRefresh({ enabled, refresh, onError = () => {}, interval = 5000, clock = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let timer, running = false, started = false, failures = 0, retryAt = 0;
  function plan(delay = interval) {
    cancel(timer);
    if (started) timer = schedule(tick, Math.max(delay, retryAt - clock()));
  }
  async function tick() {
    if (!started || running) return;
    if (!enabled() || clock() < retryAt) { plan(); return; }
    running = true;
    try { await refresh(); failures = 0; retryAt = 0; }
    catch (error) {
      failures++;
      retryAt = clock() + Math.max(Math.min(60000, interval * 2 ** Math.min(failures, 5)), (error.retryAfter || 0) * 1000);
      if (failures === 1) onError(error);
    } finally { running = false; plan(); }
  }
  return {
    start() { if (!started) { started = true; plan(); } },
    wake() { if (started && !running) plan(0); },
    stop() { started = false; cancel(timer); },
  };
}
