// Bound the atlas raster footprint for mobile canvas memory. A compact
// multi-column layout works with sparse-text recognition; symbol boxes keep
// neighboring slots separate even when the recognizer merges a whole row.
export function atlasLayout(count){
  if(!Number.isInteger(count)||count<1||count>3000)throw Error('Invalid recognition region count.');
  const columns=Math.min(12,count),rows=Math.ceil(count/columns);
  const tile=Math.min(112,Math.floor(Math.sqrt(8_000_000/(columns*rows))));
  if(tile<64)throw Error('Too many potential clues. Choose the puzzle type explicitly, or crop a smaller grid.');
  return {columns,rows,tile};
}

export function mapAtlas(data, count, columns, tile) {
  const readings=Array.from({length:count},()=>({text:'',confidence:0,parts:[],review:false}));
  const words=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[])));
  function affected(box){
    const indices=[];
    if(!box||!['x0','y0','x1','y1'].every(k=>Number.isFinite(box[k]))||box.x1<=box.x0||box.y1<=box.y0)return indices;
    for(let row=Math.max(0,Math.floor(box.y0/tile));row<=Math.floor((box.y1-1)/tile);row++)
      for(let col=Math.max(0,Math.floor(box.x0/tile));col<=Math.min(columns-1,Math.floor((box.x1-1)/tile));col++){
        const i=row*columns+col;if(i<count)indices.push(i);
      }
    return indices;
  }
  for(const word of words){
    const symbols=word.symbols?.length?word.symbols:[word];
    const wordIsOneClue=affected(word.bbox).length===1;
    for(const symbol of symbols){
      const b=symbol.bbox,cells=affected(b),text=(symbol.text||'').replace(/\s/g,'');
      if(!text)continue;
      if(cells.length!==1){for(const i of cells)readings[i].review=true;continue;}
      const entry=readings[cells[0]];
      let confidence=Number.isFinite(symbol.confidence)?symbol.confidence:0;
      // Preserve doubt when a one-clue word score is lower than its symbol score.
      if(wordIsOneClue&&Number.isFinite(word.confidence))confidence=Math.min(confidence,word.confidence);
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
