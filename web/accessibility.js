const board=document.getElementById('board'),rowsInput=document.getElementById('rows'),colsInput=document.getElementById('cols');
function selectedCells(){return [...board.querySelectorAll('.board-cell.selected')].map(el=>Number(el.dataset.cell));}
function puzzleData(){try{return JSON.parse(document.getElementById('json-data').value);}catch{return null;}}
function stopNoop(button,predicate){button.addEventListener('click',event=>{if(predicate())return;event.preventDefault();event.stopImmediatePropagation();},{capture:true});}
stopNoop(document.getElementById('remove-cage'),()=>{const cells=new Set(selectedCells()),p=puzzleData();return cells.size>0&&p?.cages?.some(c=>c.cells?.some(i=>cells.has(i)));});
stopNoop(document.getElementById('remove-inequality'),()=>{const cells=new Set(selectedCells()),p=puzzleData();return cells.size===2&&p?.inequalities?.some(q=>cells.has(q.less)&&cells.has(q.greater));});
board.onkeydown=event=>{
  const cell=event.target.closest('[data-cell]');if(!cell)return;
  const index=Number(cell.dataset.cell),cols=Number(colsInput.value),rows=Number(rowsInput.value);
  if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1)return;
  if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click();return;}
  let r=Math.floor(index/cols),c=index%cols;
  if(event.key==='ArrowLeft')c=Math.max(0,c-1);else if(event.key==='ArrowRight')c=Math.min(cols-1,c+1);else if(event.key==='ArrowUp')r=Math.max(0,r-1);else if(event.key==='ArrowDown')r=Math.min(rows-1,r+1);else return;
  event.preventDefault();const next=r*cols+c;if(next===index)return;for(const el of board.querySelectorAll('[data-cell]'))el.tabIndex=Number(el.dataset.cell)===next?0:-1;board.querySelector(`[data-cell="${next}"]`)?.focus();
};
