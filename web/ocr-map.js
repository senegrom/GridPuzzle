// Map OCR character boxes, not word boxes: Tesseract can merge an entire
// atlas row into one word even when the source digits belong to different cells.
export function mapAtlas(data, count, columns, tile) {
  const readings=Array.from({length:count},()=>({text:'',confidence:0,parts:[],review:false}));
  const words=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[])));
  function affected(box){
    const indices=[];
    for(let row=Math.max(0,Math.floor(box.y0/tile));row<=Math.floor((box.y1-1)/tile);row++)
      for(let col=Math.max(0,Math.floor(box.x0/tile));col<=Math.min(columns-1,Math.floor((box.x1-1)/tile));col++){
        const i=row*columns+col;if(i<count)indices.push(i);
      }
    return indices;
  }
  for(const word of words){
    const symbols=word.symbols?.length?word.symbols:[word];
    for(const symbol of symbols){
      const b=symbol.bbox;
      if(!b||!['x0','y0','x1','y1'].every(k=>Number.isFinite(b[k]))||b.x1<=b.x0||b.y1<=b.y0)continue;
      const cells=affected(b),text=(symbol.text||'').replace(/\s/g,'');
      if(!text)continue;
      if(cells.length!==1){for(const i of cells)readings[i].review=true;continue;}
      const entry=readings[cells[0]],confidence=Number.isFinite(symbol.confidence)?symbol.confidence:0;
      entry.parts.push({text,confidence,x:b.x0,y:b.y0});
    }
  }
  for(const r of readings){
    r.parts.sort((a,b)=>a.x-b.x||a.y-b.y);
    r.text=r.parts.map(p=>p.text).join('');
    r.confidence=r.parts.length&&!r.review?Math.min(...r.parts.map(p=>p.confidence)):0;
    delete r.parts;
  }
  return readings;
}
