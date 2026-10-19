const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {createAttachmentPreviews}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('frontend/attachment-previews.js')).toString('base64'));
 class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.isConnected=true;}
  append(e){this.children.push(e)} replaceChildren(){this.children=[]} setAttribute(k,v){this[k]=v}
 }
 global.document={createElement:tag=>new Element(tag)};
 let observer, urls=0, revoked=[];
 global.IntersectionObserver=class{constructor(cb){this.cb=cb;observer=this}observe(){}unobserve(){}disconnect(){}};
 global.URL.createObjectURL=()=>`blob:${++urls}`;global.URL.revokeObjectURL=url=>revoked.push(url);
 const realTimer=global.setTimeout;global.setTimeout=(fn,delay)=>realTimer(fn,0);
 const flush=()=>new Promise(r=>realTimer(r,10));
 const a=new Element();a.dataset.previewId='a'; const b=new Element();b.dataset.previewId='b';
 const root={querySelectorAll:()=>[a,b]};let calls=0;
 const preview=createAttachmentPreviews({load:async id=>{calls++;return new Blob([id],{type:id==='a'?'image/png':'application/pdf'})}});
 preview.observe(root);assert.equal(calls,0);
 observer.cb([{target:a,isIntersecting:true},{target:b,isIntersecting:true}]);await flush();
 assert.equal(calls,2);assert.equal(a.children[0].tag,'img');assert.equal(b.children[0].tag,'object');
 assert.equal(b.children[0].data,'blob:2#page=1&view=FitH&toolbar=0');
 preview.observe(root);observer.cb([{target:a,isIntersecting:true}]);await flush();assert.equal(calls,2);
 preview.clear();assert.deepEqual(revoked,['blob:1','blob:2']);assert.equal(preview.get('a'),undefined);
 let finish,signal; const c=new Element();c.dataset.previewId='c';
 const pending=createAttachmentPreviews({load:(_,s)=>{signal=s;return new Promise(r=>finish=r)}});
 pending.observe({querySelectorAll:()=>[c]});observer.cb([{target:c,isIntersecting:true}]);pending.clear();
 assert.equal(signal.aborted,true);finish(new Blob(['x'],{type:'image/png'}));await flush();assert.equal(urls,2);assert.equal(c.children.length,0);
 const d=new Element();d.dataset.previewId='d';
 const bounded=createAttachmentPreviews({maxBytes:1,load:async()=>new Blob(['long'],{type:'image/png'})});
 bounded.observe({querySelectorAll:()=>[d]});observer.cb([{target:d,isIntersecting:true}]);await flush();assert.match(d.textContent,/Limite/);assert.equal(urls,2);
 global.setTimeout=realTimer;
 console.log('PASS: lazy loading, image/PDF render, cache reuse, logout cancellation, URL cleanup, memory cap.');
})().catch(e=>{console.error(e);process.exitCode=1});
