export function fitScale(width, height, viewportWidth, viewportHeight) {
  return Math.min(1, Math.max(1, viewportWidth - 32) / width, Math.max(1, viewportHeight - 32) / height);
}
export function boundedTransform(state, width, height, viewportWidth, viewportHeight) {
  const dx = Math.max(0, (width * state.scale - viewportWidth) / 2);
  const dy = Math.max(0, (height * state.scale - viewportHeight) / 2);
  return {...state, x:dx ? Math.max(-dx, Math.min(dx, state.x)) : 0, y:dy ? Math.max(-dy, Math.min(dy, state.y)) : 0};
}
export function zoomAt(state, scale, point = {x:0,y:0}) {
  const ratio = scale / state.scale;
  return {scale, x:point.x - (point.x - state.x) * ratio, y:point.y - (point.y - state.y) * ratio};
}

// The original authenticated blob is displayed directly: no resize/recompression.
export function openImageViewer(blob, fileName) {
  document.querySelector('#modal')?.close();
  document.querySelector('#modal')?.remove();
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.id = 'modal'; dialog.className = 'image-lightbox';
  dialog.setAttribute('aria-label', 'Visualizador de imagem');
  dialog.innerHTML = `<header class="image-lightbox-bar"><strong class="image-lightbox-name"></strong><div class="image-lightbox-tools"><button type="button" data-tool="out" aria-label="Diminuir zoom">−</button><output aria-label="Nível de zoom">—</output><button type="button" data-tool="in" aria-label="Aumentar zoom">+</button><button type="button" data-tool="fit">Ajustar à tela</button><button type="button" data-tool="actual" title="Um pixel da imagem por pixel CSS">100%</button><a class="image-lightbox-download">Baixar</a><button type="button" data-tool="close" aria-label="Fechar imagem">✕</button></div></header><div class="image-lightbox-stage"><img alt="Imagem completa da conversa" draggable="false"><p class="image-lightbox-loading" role="status">Carregando imagem…</p></div><p class="image-lightbox-help">Role para ampliar · Arraste para mover · Duplo clique para alternar o zoom · Esc para fechar</p>`;
  const $ = selector => dialog.querySelector(selector);
  $('.image-lightbox-name').textContent = fileName || 'Imagem';
  const stage = $('.image-lightbox-stage'), img = $('img'), output = $('output');
  const url = URL.createObjectURL(blob), download = $('a'); download.href = url; download.download = fileName || 'imagem';
  let state = {scale:1,x:0,y:0}, fitted = true, ready = false, disposed = false;
  const pointers = new Map(); let pinch = null;
  const fit = () => fitScale(img.naturalWidth, img.naturalHeight, stage.clientWidth, stage.clientHeight);
  function paint() {
    if (!ready) return;
    state = boundedTransform(state,img.naturalWidth,img.naturalHeight,stage.clientWidth,stage.clientHeight);
    img.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    output.textContent = `${Math.round(state.scale * 100)}%`;
    stage.classList.toggle('can-pan', img.naturalWidth*state.scale > stage.clientWidth || img.naturalHeight*state.scale > stage.clientHeight);
  }
  function adjust() { if (!ready) return; fitted = true; state = {scale:fit(),x:0,y:0}; paint(); }
  function zoom(value, point) {
    if (!ready) return;
    fitted = false; state = zoomAt(state,Math.max(Math.min(fit(),0.1),Math.min(8,value)),point); paint();
  }
  const local = point => { const r=stage.getBoundingClientRect(); return {x:point.x-r.left-r.width/2,y:point.y-r.top-r.height/2}; };
  function beginPinch() {
    if (pointers.size !== 2) { pinch=null; return; }
    const [a,b]=[...pointers.values()];
    pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),center:local({x:(a.x+b.x)/2,y:(a.y+b.y)/2}),state:{...state}};
  }
  stage.addEventListener('pointerdown',e=>{
    if (!ready || (e.pointerType==='mouse' && e.button!==0)) return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); stage.setPointerCapture(e.pointerId); beginPinch();
  });
  stage.addEventListener('pointermove',e=>{
    const previous=pointers.get(e.pointerId); if (!previous) return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); fitted=false;
    if (pointers.size===2 && pinch) {
      const [a,b]=[...pointers.values()], center=local({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
      const scale=Math.max(Math.min(fit(),0.1),Math.min(8,pinch.state.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));
      state=zoomAt(pinch.state,scale,pinch.center);state.x+=center.x-pinch.center.x;state.y+=center.y-pinch.center.y;
    } else if (pointers.size===1) {state.x+=e.clientX-previous.x;state.y+=e.clientY-previous.y;}
    paint();
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) stage.addEventListener(event,e=>{pointers.delete(e.pointerId);beginPinch();});
  stage.addEventListener('wheel',e=>{e.preventDefault();zoom(state.scale*Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*0.003),local({x:e.clientX,y:e.clientY}));},{passive:false});
  stage.addEventListener('dblclick',e=>{if (Math.abs(state.scale-fit())<0.01) zoom(Math.max(1,fit()*2),local({x:e.clientX,y:e.clientY}));else adjust();});
  $('[data-tool=in]').onclick=()=>zoom(state.scale*1.25);
  $('[data-tool=out]').onclick=()=>zoom(state.scale/1.25);
  $('[data-tool=fit]').onclick=adjust;
  $('[data-tool=actual]').onclick=()=>zoom(1);
  $('[data-tool=close]').onclick=()=>dialog.close();
  dialog.addEventListener('keydown',e=>{
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['+','=','-','0','1','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    if (e.key==='+' || e.key==='=') zoom(state.scale*1.25);
    if (e.key==='-') zoom(state.scale/1.25);
    if (e.key==='0') adjust();
    if (e.key==='1') zoom(1);
    if (e.key.startsWith('Arrow')) {fitted=false;state.x+=e.key==='ArrowLeft'?60:e.key==='ArrowRight'?-60:0;state.y+=e.key==='ArrowUp'?60:e.key==='ArrowDown'?-60:0;paint();}
  });
  const resize = new ResizeObserver(()=>{if(fitted)adjust();else paint();});
  const removal = new MutationObserver(()=>{if(!dialog.isConnected)cleanup();});
  function cleanup() {
    if(disposed)return;disposed=true;resize.disconnect();removal.disconnect();pointers.clear();
    img.onload=null;img.onerror=null;img.removeAttribute('src');URL.revokeObjectURL(url);
  }
  dialog.addEventListener('close',()=>{cleanup();dialog.remove();if(previousFocus?.isConnected)previousFocus.focus();},{once:true});
  img.onload=()=>{
    if(disposed)return;ready=true;img.style.width=`${img.naturalWidth}px`;img.style.height=`${img.naturalHeight}px`;
    $('.image-lightbox-loading').hidden=true;adjust();
  };
  img.onerror=()=>{$('.image-lightbox-loading').textContent='Não foi possível exibir a imagem. Use Baixar.';};
  document.body.append(dialog);dialog.showModal();resize.observe(stage);removal.observe(document.body,{childList:true});img.src=url;
  return dialog;
}
