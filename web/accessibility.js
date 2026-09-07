export function moveIndex(index,key,rows,cols){
  let r=Math.floor(index/cols),c=index%cols;
  if(key==='ArrowLeft')c=Math.max(0,c-1);else if(key==='ArrowRight')c=Math.min(cols-1,c+1);else if(key==='ArrowUp')r=Math.max(0,r-1);else if(key==='ArrowDown')r=Math.min(rows-1,r+1);else return index;
  return r*cols+c;
}
export function hasCageRemoval(p,cells){const selected=new Set(cells);return selected.size>0&&Boolean(p?.cages?.some(c=>c.cells?.some(i=>selected.has(i))));}
export function hasInequalityRemoval(p,cells){const selected=new Set(cells);return selected.size===2&&Boolean(p?.inequalities?.some(q=>selected.has(q.less)&&selected.has(q.greater)));}

if(typeof document!=='undefined'){
  const board=document.getElementById('board'),rowsInput=document.getElementById('rows'),colsInput=document.getElementById('cols');
  const selectedCells=()=>[...board.querySelectorAll('.board-cell.selected')].map(el=>Number(el.dataset.cell));
  const puzzleData=()=>{try{return JSON.parse(document.getElementById('json-data').value);}catch{return null;}};
  const stopNoop=(button,predicate)=>button.addEventListener('click',event=>{if(predicate())return;event.preventDefault();event.stopImmediatePropagation();},{capture:true});
  stopNoop(document.getElementById('remove-cage'),()=>hasCageRemoval(puzzleData(),selectedCells()));
  stopNoop(document.getElementById('remove-inequality'),()=>hasInequalityRemoval(puzzleData(),selectedCells()));
  // Let app.js own valid movement so its private roving-focus state stays in
  // sync. Only intercept arrows that would wrap/clamp into a different row or
  // column at the board boundary.
  board.addEventListener('keydown',event=>{
    if(!event.key.startsWith('Arrow'))return;
    const cell=event.target.closest('[data-cell]');if(!cell)return;
    const index=Number(cell.dataset.cell),cols=Number(colsInput.value),rows=Number(rowsInput.value);
    if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1)return;
    if(moveIndex(index,event.key,rows,cols)!==index)return;
    event.preventDefault();event.stopImmediatePropagation();
  },{capture:true});
}
