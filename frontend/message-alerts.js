// Session-local state: no message bodies, contact data or credentials persisted.
export function createAlertState(onChange = () => {}, onSound = () => {}) {
  let baseline = Infinity;
  const seen = new Map(), pending = new Map();
  const update = () => onChange(pending.size);
  return {
    reset(since) { baseline = since ? Date.parse(since) : Infinity; seen.clear(); pending.clear(); update(); },
    ingest(items) {
      let added = false;
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.set(item.id, Date.parse(item.createdAt));
        if (Date.parse(item.createdAt) <= baseline) continue;
        pending.set(item.id, item.conversationId); added = true;
      }
      const cutoff = Date.now() - 86400000;
      for (const [id, time] of seen) if (time < cutoff && !pending.has(id)) seen.delete(id);
      update(); if (added) onSound();
    },
    read(items) { for (const item of items) { seen.set(item.id, Date.parse(item.createdAt)); pending.delete(item.id); } update(); },
    retain(conversations) { const allowed = new Set(conversations); for (const [id, c] of pending) if (!allowed.has(c)) pending.delete(id); update(); },
    conversations() { return [...new Set(pending.values())]; },
    count() { return pending.size; },
  };
}
export function createAlertSound(win = window) {
  let context, enabled = false, generation = 0;
  function play() {
    if (!enabled || context?.state !== 'running') return;
    const osc = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
    osc.type = 'sine'; osc.frequency.setValueAtTime(740, now); osc.frequency.setValueAtTime(880, now + .12);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.12, now + .02);
    gain.gain.exponentialRampToValueAtTime(.001, now + .3);
    osc.connect(gain); gain.connect(context.destination); osc.start(now); osc.stop(now + .32);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  return {
    async enable() {
      const Audio = win.AudioContext || win.webkitAudioContext;
      if (!Audio) throw new Error('Este navegador não oferece suporte ao aviso sonoro.');
      const current = ++generation;
      context ||= new Audio(); await context.resume();
      if (current !== generation) return;
      if (context.state !== 'running') throw new Error('O navegador bloqueou o áudio. Clique novamente em Ativar som.');
      enabled = true; play();
    },
    mute() { generation++; enabled = false; },
    enabled: () => enabled && context?.state === 'running',
    play,
  };
}
