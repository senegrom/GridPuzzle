export const TYPES = Object.freeze({sudoku:'Sudoku',killersudoku:'Killer Sudoku',futoshiki:'Futoshiki',kenken:'KenKen',latinsquare:'Latin square',diagonallatinsquare:'Diagonal Latin square',pandiagonallatinsquare:'Pandiagonal Latin square',hidato:'Hidato',numbrix:'Numbrix',kakuro:'Kakuro',slitherlink:'Slitherlink'});
export const clone = value => JSON.parse(JSON.stringify(value));
export const isCage = type => ['killersudoku','kenken'].includes(type);
export function boxShape(n) { let r=Math.floor(Math.sqrt(n)); while(n%r) r--; return [r,n/r]; }
export function makePuzzle(type='sudoku',rows=9,cols=rows) {
  const [boxRows,boxCols]=boxShape(rows);
  return {version:1,type,rows,cols,boxRows,boxCols,cells:Array(rows*cols).fill(null),cages:[],inequalities:[],clues:[]};
}
export function checkShape(p) {
  if(!p || typeof p!=='object' || Array.isArray(p) || !Object.hasOwn(TYPES,p.type)) throw Error('Choose a supported puzzle type.');
  for(const k of ['rows','cols']) if(!Number.isInteger(p[k]) || p[k]<1 || p[k]>25) throw Error('Board dimensions must be whole numbers from 1 to 25.');
  if(!Array.isArray(p.cells)||p.cells.length!==p.rows*p.cols) throw Error('The number of cells does not match the board dimensions.');
  if(!['hidato','numbrix','kakuro','slitherlink'].includes(p.type)&&p.rows!==p.cols) throw Error('This type needs a square grid.');
  const allowed=new Set(['version','type','rows','cols','boxRows','boxCols','cells','cages','inequalities','clues']);
  for(const key of Object.keys(p)) if(!allowed.has(key)) throw Error(`Unsupported puzzle field: ${key}`);
  if(p.version!==undefined&&p.version!==1) throw Error('Unsupported puzzle format version.');
  const maximum=p.type==='slitherlink'?4:['hidato','numbrix'].includes(p.type)?p.cells.filter(v=>v!=='#').length:p.type==='kakuro'?9:p.rows;
  p.cells.forEach((v,i)=>{if(v===null)return; if(v==='#'&&['hidato','kakuro'].includes(p.type))return;if(!Number.isInteger(v)||v<(p.type==='slitherlink'?0:1)||v>maximum)throw Error(`Cell ${i+1} is outside the allowed range.`);});
  for(const key of ['cages','inequalities','clues']) if(p[key]!==undefined&&(!Array.isArray(p[key])||p[key].length>2*p.cells.length)) throw Error(`Invalid ${key}.`);
  if(isCage(p.type)&&!Array.isArray(p.cages)) throw Error('This puzzle needs cage definitions.');
  for(const cage of p.cages||[]) {
    if(!cage||!Array.isArray(cage.cells)||!cage.cells.length||cage.cells.some(i=>!Number.isInteger(i)||i<0||i>=p.cells.length)) throw Error('Invalid cage cells.');
  }
  for(const q of p.inequalities||[]) if(!q||[q.less,q.greater].some(i=>!Number.isInteger(i)||i<0||i>=p.cells.length)) throw Error('Invalid inequality cells.');
  for(const q of p.clues||[]) if(!q||!Number.isInteger(q.cell)||q.cell<0||q.cell>=p.cells.length) throw Error('Invalid Kakuro clue cell.');
  return p;
}
export function conflicts(p) {
  const bad=new Set();
  const unique=indices=>{const seen=new Map();for(const i of indices){const v=p.cells[i];if(!Number.isInteger(v))continue;if(seen.has(v)){bad.add(i);bad.add(seen.get(v));}else seen.set(v,i);}};
  const all=Array.from({length:p.cells.length},(_,i)=>i);
  if(['hidato','numbrix'].includes(p.type)) unique(all);
  else if(!['kakuro','slitherlink'].includes(p.type)) {
    for(let r=0;r<p.rows;r++)unique(all.filter(i=>Math.floor(i/p.cols)===r));
    for(let c=0;c<p.cols;c++)unique(all.filter(i=>i%p.cols===c));
    if(['sudoku','killersudoku'].includes(p.type)&&p.boxRows>0&&p.boxCols>0)
      for(let r=0;r<p.rows;r+=p.boxRows)for(let c=0;c<p.cols;c+=p.boxCols) unique(all.filter(i=>Math.floor(i/p.cols)>=r&&Math.floor(i/p.cols)<r+p.boxRows&&i%p.cols>=c&&i%p.cols<c+p.boxCols));
    if(['diagonallatinsquare','pandiagonallatinsquare'].includes(p.type)) {
      const offsets=p.type==='pandiagonallatinsquare'?Array.from({length:p.rows},(_,i)=>i):[0];
      for(const k of offsets){unique(all.filter(i=>i%p.cols===(Math.floor(i/p.cols)+k)%p.cols));unique(all.filter(i=>i%p.cols===(p.cols-1-Math.floor(i/p.cols)+k)%p.cols));}
    }
  }
  for(const q of p.inequalities||[])if(Number.isInteger(p.cells[q.less])&&Number.isInteger(p.cells[q.greater])&&p.cells[q.less]>=p.cells[q.greater]){bad.add(q.less);bad.add(q.greater);}
  return bad;
}
export function demo(type='sudoku') {
  if(type==='sudoku') {
    const p=makePuzzle();p.cells=[...'530070000600195000098000060800060003400803001700020006060000280000419005000080079'].map(v=>+v||null);return p;
  }
  if(type==='slitherlink'){const p=makePuzzle(type,2);p.cells=[2,2,2,2];return p;}
  if(type==='kakuro'){const p=makePuzzle(type,3);p.cells=['#','#','#','#',1,null,'#',null,null];p.clues=[{cell:1,down:4},{cell:2,down:6},{cell:3,across:3},{cell:6,across:7}];return p;}
  if(['hidato','numbrix'].includes(type)){const p=makePuzzle(type,3);p.cells=[1,null,3,null,5,null,7,null,9];return p;}
  const n=type==='pandiagonallatinsquare'?5:4,p=makePuzzle(type,n);
  const solution=type==='pandiagonallatinsquare'?Array.from({length:25},(_,i)=>(2*Math.floor(i/5)+i%5)%5+1):type==='diagonallatinsquare'?[1,2,3,4,3,4,1,2,4,3,2,1,2,1,4,3]:[1,2,3,4,3,4,1,2,2,1,4,3,4,3,2,1];
  p.cells=solution.map((v,i)=>i%n===0?null:v);
  if(isCage(type))p.cages=Array.from({length:n},(_,r)=>({cells:Array.from({length:n},(_,c)=>r*n+c),target:n*(n+1)/2,op:'+'}));
  if(type==='futoshiki')p.inequalities=[{less:0,greater:1}];
  return p;
}
// Heuristics are suggestions, not proofs of a puzzle's rules.
export function classify({rows,cols,values=[],signs=0,labels=0,operators=0,black=0,triangles=0,boxes=false,dots=false}) {
  if(black&&triangles)return {type:'kakuro',review:true,reason:'Cross-sum layout detected. Check black cells and both clue directions.'};
  if(signs)return {type:'futoshiki',review:true,reason:'Inequalities detected. Check the direction of every sign.'};
  if(labels>1)return {type:operators?'kenken':'killersudoku',review:true,reason:'Cages detected. Check every boundary, target and operator.'};
  // One OCR merge (e.g. a spurious extra character beside an 8) must not turn
  // a clear boxed Sudoku layout into a different set of path-puzzle rules.
  if(rows===cols&&boxes&&!black)return {type:'sudoku',review:false,reason:'Sudoku box pattern detected. Extra variant rules still need an explicit type.'};
  if(black||values.some(n=>Number.isInteger(n)&&n>Math.max(rows,cols)))return {type:black?'hidato':'numbrix',review:true,reason:'Number-path layout: confirm Hidato (diagonals allowed) or Numbrix (orthogonal only).'};
  if(dots&&values.some(Number.isInteger)&&values.filter(Number.isInteger).every(n=>n<=4))return {type:'slitherlink',review:true,reason:'Loop layout suggested. Check the dimensions and clues, including zeroes.'};
  return {type:rows===cols?'sudoku':'numbrix',review:true,reason:'The rules are ambiguous from the grid alone. Choose the correct type before solving.'};
}
