import test from 'node:test';
import assert from 'node:assert/strict';
import { gridContent, sameGridContent } from '../live-content.js';
import { gridAnchor, matchGrid } from '../live-registration.js';
import { createTrackingCore } from '../live-tracking-core.js';
// Roughly 40 source pixels per cell matches the reported acquisition scale.
// Large-cell area averaging would hide the raw/normalized noise-unit bug.
const width=40,height=40,corners=[{x:1,y:1},{x:38,y:1},{x:38,y:38},{x:1,y:38}];
function picture({paper=175,seed=1,noise=0,mark=false}={}) {
 let random=seed;const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  random=(Math.imul(random,1664525)+1013904223)>>>0;
  const grain=noise ? (random % (noise*2+1))-noise : 0;
  const ink=mark&&((x>=16&&x<19&&y>=14&&y<27)||(x>=16&&x<24&&y>=14&&y<17));
  const level=(ink?paper-40:paper)+grain,at=(y*width+x)*4;
  data[at]=data[at+1]=data[at+2]=level;data[at+3]=255;
 }
 return {width,height,data};
}
for(const paper of [80,175,235])for(const seed of [1,11,129])test(`blank-cell noise is not a changed clue after stretching, paper ${paper}, seed ${seed}`,()=>{
 const a=picture({paper,noise:6,seed}),b=picture({paper,noise:6,seed:seed+7});
 assert.equal(sameGridContent(gridContent(a,corners,1,1),gridContent(b,corners,1,1)),true);
 assert.ok(matchGrid(gridAnchor(a,corners,1,1),b));
});
for(const paper of [80,175,235])test(`a new faint printed mark is still rejected on noisy paper ${paper}`,()=>{
 const a=picture({paper,noise:4,seed:13}),b=picture({paper,noise:4,seed:71,mark:true});
 assert.equal(sameGridContent(gridContent(a,corners,1,1),gridContent(b,corners,1,1)),false);
 assert.equal(matchGrid(gridAnchor(a,corners,1,1),b),null);
 assert.equal(matchGrid(gridAnchor(b,corners,1,1),a),null,'erasing weak ink must also reject identity');
});
test('worker rejection explains the affected region but does not return source pixels',()=>{
 const core=createTrackingCore(),a=picture(),b=picture({mark:true});
 const anchor=core.run({op:'anchor',image:a,corners,rows:1,cols:1,anchors:[]}).anchor;
 const r=core.run({op:'verify',image:b,anchors:[anchor.id]});
 assert.equal(r.proofs[anchor.id],null);assert.deepEqual(r.rejections[anchor.id],{reason:'cell-content',region:0});
 assert.doesNotMatch(JSON.stringify(r),/pixels|gray|data|image/);
});
test('an absent worker anchor is reported and never authorizes a frame',()=>{
 const r=createTrackingCore().run({op:'verify',image:picture(),anchors:[99]});
 assert.equal(r.proofs[99],null);assert.deepEqual(r.rejections[99],{reason:'missing-anchor'});
});
