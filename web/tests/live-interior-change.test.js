import test from 'node:test';
import assert from 'node:assert/strict';
import { gridContent, sameGridContent } from '../live-content.js';

const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
function shape({ removed=false, inverted=false, brightness=0, contrast=220, noise=0, seed=1 }={}) {
  const width=100,height=100,data=new Uint8ClampedArray(40000).fill(255);let random=seed;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let ink=(x>=43&&x<46&&y>=37&&y<66)||(x>=59&&x<62&&y>=37&&y<66)||
      (x>=43&&x<62&&((y>=35&&y<38)||(y>=49&&y<52)||(y>=64&&y<67)));
    // A small 8-like mark becomes 3-like; most pixels and both horizontal
    // strokes remain unchanged. The former area-only guard accepted this.
    if(removed&&x>=43&&x<46&&((y>=39&&y<48)||(y>=53&&y<63))) ink=false;
    random=(Math.imul(random,1664525)+1013904223)>>>0;
    let value=(ink?240-contrast:240)+brightness;
    if(inverted) value=255-value;
    const at=4*(y*width+x);data[at]=data[at+1]=data[at+2]=value+(noise?random%(2*noise+1)-noise:0);
  }
  return gridContent({width,height,data},corners,1,1);
}
for(const inverted of [false,true]) {
  test(`small missing interior strokes invalidate the old clue, polarity ${inverted}`,()=>{
    const original=shape({inverted}), changed=shape({inverted,removed:true});
    assert.equal(sameGridContent(original,changed),false);
    assert.equal(sameGridContent(changed,original),false);
  });
  test(`unchanged interior strokes tolerate uniform illumination, polarity ${inverted}`,()=>{
    assert.equal(sameGridContent(shape({inverted}),shape({inverted,brightness:2})),true);
  });
}
// A residual noise floor scaled by the contrast stretch (#73) let this change
// through up to print contrast 80 (8 to 3) and 130 (3 to 8) on clean prints.
// The floor now follows the grain actually measured in the two frames.
for(const contrast of [15,25,40,60,80,100,130])
  test(`an 8 becoming a 3, and a 3 becoming an 8, are caught at print contrast ${contrast}`,()=>{
    const eight=shape({contrast}),three=shape({contrast,removed:true});
    assert.equal(sameGridContent(eight,three),false);assert.equal(sameGridContent(three,eight),false);
    assert.equal(sameGridContent(eight,shape({contrast,brightness:2})),true);
  });
for(const contrast of [50,80,130])
  test(`light strokes on a dark ground are caught at print contrast ${contrast}`,()=>{
    const eight=shape({contrast,inverted:true}),three=shape({contrast,inverted:true,removed:true});
    assert.equal(sameGridContent(eight,three),false);assert.equal(sameGridContent(three,eight),false);
  });
for(const contrast of [30,60,130])
  test(`with ±3 grain the change is still caught at print contrast ${contrast}, and grain alone is not a change`,()=>{
    for(const seed of [3,4,5]) {
      const eight=shape({contrast,noise:3,seed}),three=shape({contrast,noise:3,seed:seed+90,removed:true});
      assert.equal(sameGridContent(eight,three),false);assert.equal(sameGridContent(three,eight),false);
      assert.equal(sameGridContent(eight,shape({contrast,noise:3,seed:seed+200})),true);
      assert.equal(sameGridContent(three,shape({contrast,noise:3,seed:seed+300,removed:true})),true);
    }
  });
