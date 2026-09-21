import test from "node:test";
import assert from "node:assert/strict";
import { estimateGrid, findGrid } from "../geometry.js";

// Integer raster positions deliberately alternate floor/ceil gaps. A local
// median must not accumulate rounding drift across the entire lattice.
function image(rows, cols, width=540, height=540, lineWidth=2, grey=30, margin=0, boxes=false) {
  const data=new Uint8ClampedArray(width*height*4).fill(255), right=width-margin-1, bottom=height-margin-1;
  const px=(x,y,v=grey)=>{if(x>=0&&y>=0&&x<width&&y<height){const at=(y*width+x)*4;data[at]=data[at+1]=data[at+2]=v;}};
  const draw=(count,horizontal)=>{ for(let k=0;k<=count;k++) {
    const thick=boxes&&k%5===0 ? lineWidth+2 : lineWidth;
    const at=Math.round(margin+k*((horizontal?bottom:right)-margin)/count);
    for(let d=0;d<thick;d++) for(let t=margin;t<=(horizontal?right:bottom);t++)
      if(horizontal)px(t,at+d-Math.floor(thick/2));else px(at+d-Math.floor(thick/2),t);
  }};
  draw(rows,true);draw(cols,false);return{width,height,data};
}

function check(result, rows, cols, label) {
  assert.deepEqual([result.rows, result.cols], [rows, cols], label);
  if ("confidence" in result) assert.ok(result.confidence >= .9, label);
}
for (let n = 3; n <= 25; n++)
  test(`${n} by ${n}: rounded lattice and complete detector at three stroke widths`, () => {
    for (const width of [1, 2, 3]) {
      check(estimateGrid(image(n, n, 540, 540, width, 0)), n, n, `warp ${n}/${width}`);
      check(findGrid(image(n, n, 640, 640, width, 0, 38)), n, n, `frame ${n}/${width}`);
    }
  });
for (const [rows, cols] of [[3,25],[25,3],[9,21],[21,9],[16,25],[25,16],[21,25],[25,21]])
  test(`${rows} by ${cols}: independent rectangular lattice pitches`, () => {
    for (const width of [1, 3]) {
      check(estimateGrid(image(rows, cols, 540, 540, width, 0)), rows, cols, "warp");
      check(findGrid(image(rows, cols, 640, 480, width, 0, 38)), rows, cols, "frame");
    }
  });
