const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {fitScale,boundedTransform,zoomAt}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('frontend/image-viewer.js')).toString('base64'));
 assert.equal(fitScale(4000,3000,1200,900),868/3000);
 assert.equal(fitScale(300,200,1200,900),1);
 assert.equal(fitScale(1000,4000,400,700),668/4000);
 assert.deepEqual(boundedTransform({scale:0.1,x:200,y:-500},4000,3000,1200,900),{scale:0.1,x:0,y:0});
 assert.deepEqual(boundedTransform({scale:1,x:9999,y:-9999},4000,3000,1200,900),{scale:1,x:1400,y:-1050});
 const before={scale:0.5,x:30,y:-20},point={x:200,y:100};
 const after=zoomAt(before,2,point);
 assert.equal((point.x-before.x)/before.scale,(point.x-after.x)/after.scale);
 assert.equal((point.y-before.y)/before.scale,(point.y-after.y)/after.scale);
 assert.deepEqual(zoomAt(after,before.scale,point),before);
 const limited=boundedTransform(after,4000,3000,8000,6000);assert.equal(limited.x,0);assert.equal(limited.y,0);
 console.log('PASS: landscape/portrait fit, actual size, pan boundaries, cursor-anchored zoom and resize.');
})().catch(e=>{console.error(e);process.exitCode=1});
