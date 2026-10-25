const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { createAlertState, createAlertSound } = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync('frontend/message-alerts.js')).toString('base64'));
  let count = 0, sounds = 0;
  const state = createAlertState(n => count = n, () => sounds++);
  const now = Date.now();
  const message = (id, conversationId = 'a', offset = 1000) => ({ id, conversationId, createdAt: new Date(now + offset).toISOString() });
  state.reset(new Date(now).toISOString());
  state.ingest([message('old','a',-1000)]); assert.equal(count, 0); assert.equal(sounds, 0);
  state.ingest([message('1'),message('2'),message('3','b')]); assert.equal(count, 3); assert.equal(sounds, 1);
  state.ingest([message('1'),message('2')]); assert.equal(count, 3); assert.equal(sounds, 1);
  state.read([message('1')]); assert.equal(count, 2);
  state.read([message('future')]); state.ingest([message('future')]); assert.equal(count, 2); assert.equal(sounds, 1);
  state.retain(['b']); assert.equal(count, 1); assert.deepEqual(state.conversations(), ['b']);
  state.reset(); assert.equal(count, 0); assert.deepEqual(state.conversations(), []);
  const batch = Array.from({length:250}, (_,i) => message(String(i)));
  state.reset(new Date(now).toISOString());
  for(let i=0;i<250;i+=100) state.ingest(batch.slice(i,i+100));
  state.ingest(batch); assert.equal(count,250);
  let played = 0;
  class AudioMock {
    state = 'suspended'; currentTime = 0;
    async resume(){this.state='running';}
    createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},start(){played++;},stop(){},disconnect(){}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const sound=createAlertSound({AudioContext:AudioMock}); sound.play(); assert.equal(played,0);
  await sound.enable(); assert.equal(played,1); sound.play(); assert.equal(played,2);
  sound.mute(); sound.play(); assert.equal(played,2);
  await assert.rejects(createAlertSound({}).enable(),/suporte/);
  console.log('PASS alerts: history, multiple messages, overlap/retry dedup, visible reads, permission loss, logout, pagination, opt-in audio and mute');
})().catch(e=>{console.error(e);process.exit(1);});
