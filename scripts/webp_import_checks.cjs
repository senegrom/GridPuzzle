// Synthetic lossless 3200x800 colour quadrants, not a user photograph.
const assert = require('node:assert/strict');
const fixture = 'UklGRjABAABXRUJQVlA4TCMBAAAvf8zHAB8gICEs8T/bDBIIEErECNcmEEhi2x9hmPkPPSc4YKZtm5EcyZEchlyO6P8EbI6fI' + '//xH'.repeat(38) + '/9h2eU4OfI' + 'f//E'.repeat(38) + 'flgEA';
async function webpProbe(encoded) {
  const { importPhoto } = await import('./photo-import.js');
  const { photoDetail, rotatePhotoSource } = await import('./photo-detail.js');
  const { validQuad } = await import('./geometry.js');
  const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),actual=globalThis.createImageBitmap,rows=[];
  const join=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
  const chunk=(kind,data)=>{const out=new Uint8Array(8+data.length+data.length%2);for(let i=0;i<4;i++)out[i]=kind.charCodeAt(i);
    new DataView(out.buffer).setUint32(4,data.length,true);out.set(data,8);return out;};
  function imageFile(value,little,prefix) {
    const exif=new Uint8Array(26),v=new DataView(exif.buffer);
    exif.set(little?[73,73]:[77,77]);v.setUint16(2,42,little);v.setUint32(4,8,little);v.setUint16(8,1,little);
    v.setUint16(10,0x112,little);v.setUint16(12,3,little);v.setUint32(14,1,little);v.setUint16(18,value,little);
    const x=new Uint8Array(10);x[0]=8;x[4]=3199&255;x[5]=3199>>8;x[7]=799&255;x[8]=799>>8;
    const body=join(chunk('VP8X',x),raw.subarray(12),chunk('EXIF',prefix?join(new Uint8Array([69,120,105,102,0,0]),exif):exif));
    const head=raw.slice(0,12);new DataView(head.buffer).setUint32(4,body.length+4,true);
    return new Blob([head,body],{type:'image/webp'});
  }
  const palette=[[220,30,30],[30,180,30],[30,30,220],[220,200,30]];
  const colors=canvas=>[[.25,.25],[.75,.25],[.75,.75],[.25,.75]].map(([x,y])=>{
    const value=canvas.getContext('2d').getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data;
    const distances=palette.map(rgb=>rgb.reduce((s,v,k)=>s+(v-value[k])**2,0));return distances.indexOf(Math.min(...distances));
  });
  const quad=canvas=>[{x:0,y:0},{x:canvas.width-1,y:0},{x:canvas.width-1,y:canvas.height-1},{x:0,y:canvas.height-1}];
  try {
    for(const fallback of [false,true])for(let orientation=1;orientation<=8;orientation++) {
      const row={orientation,fallback,decodes:[],details:[]};rows.push(row);let preview=null,stage='import';
      const decoder=async(...args)=>{const bitmap=await actual(...args);row.decodes.push({stage,width:bitmap.width,height:bitmap.height});return bitmap;};
      globalThis.createImageBitmap=fallback?undefined:decoder;
      try {
        ({image:preview}=await importPhoto(imageFile(orientation,orientation%2===0,fallback)));
        row.preview={size:[preview.width,preview.height],colors:colors(preview)};
        globalThis.createImageBitmap=decoder;stage='detail';
        for(let turns=0;turns<4;turns++) {
          const detail=await photoDetail(preview,quad(preview));
          try {row.details.push({turns,enhanced:detail.enhanced,size:[detail.image.width,detail.image.height],
            colors:colors(detail.image),validCorners:validQuad(detail.corners,detail.image.width,detail.image.height)});}
          finally {detail.release();}
          if(turns<3) {
            const next=document.createElement('canvas');next.width=preview.height;next.height=preview.width;
            const ctx=next.getContext('2d');ctx.translate(preview.height,0);ctx.rotate(Math.PI/2);ctx.drawImage(preview,0,0);
            rotatePhotoSource(preview,next);preview.width=preview.height=0;preview=next;
          }
        }
      } finally {if(preview)preview.width=preview.height=0;globalThis.createImageBitmap=actual;}
    }
  } finally {globalThis.createImageBitmap=actual;}
  return rows;
}
function assertRows(rows) {
  assert.equal(rows.length,16);
  const maps=[[0,1,2,3],[1,0,3,2],[2,3,0,1],[3,2,1,0],[0,3,2,1],[3,0,1,2],[2,1,0,3],[1,2,3,0]];
  for(const row of rows) {
    let expected=maps[row.orientation-1];
    assert.deepEqual(row.preview.colors,expected,`WebP ${row.orientation}, fallback ${row.fallback}: preview rotation/mirroring`);
    assert.deepEqual(row.preview.size,row.orientation>=5?[400,1600]:[1600,400]);
    const imports=row.decodes.filter(d=>d.stage==='import');
    assert.deepEqual(imports,row.fallback?[]:[{stage:'import',width:1600,height:400}],'native preview is bounded on encoded axes');
    assert.equal(row.details.length,4);
    for(const detail of row.details) {
      assert.equal(detail.enhanced,true);assert.equal(detail.validCorners,true);
      assert.deepEqual(detail.colors,expected,`WebP ${row.orientation} detail + ${detail.turns} user turns`);
      const swap=(Number(row.orientation>=5)+detail.turns)%2;
      assert.deepEqual(detail.size,swap?[450,1800]:[1800,450]);
      expected=[expected[3],expected[0],expected[1],expected[2]];
    }
    assert.deepEqual(row.decodes.filter(d=>d.stage==='detail'),Array.from({length:4},()=>({stage:'detail',width:3200,height:800})));
  }
}
async function webpImports(page,report,base) {
  await page.goto(base);await page.waitForSelector('body[data-ready="true"]');
  const rows=await page.evaluate(webpProbe,fixture);report.webpImport={nativeWebP:true,syntheticFixture:true,cases:rows};assertRows(rows);
}
module.exports={webpImports,webpProbe,assertRows,fixture};
