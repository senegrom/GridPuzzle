import test from 'node:test';
import assert from 'node:assert/strict';
import { gridContent, sameGridContent } from '../live-content.js';

const corners=[{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
function shape({ removed=false, inverted=false, brightness=0 }={}) {
  const width=100,height=100,data=new Uint8ClampedArray(40000).fill(255);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let ink=(x>=43&&x<46&&y>=37&&y<66)||(x>=59&&x<62&&y>=37&&y<66)||
      (x>=43&&x<62&&((y>=35&&y<38)||(y>=49&&y<52)||(y>=64&&y<67)));
    // A small 8-like mark becomes 3-like; most pixels and both horizontal
    // strokes remain unchanged. The former area-only guard accepted this.
    if(removed&&x>=43&&x<46&&((y>=39&&y<48)||(y>=53&&y<63))) ink=false;
    let value=(ink?20:240)+brightness;
    if(inverted) value=255-value;
    const at=4*(y*width+x);data[at]=data[at+1]=data[at+2]=value;
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
