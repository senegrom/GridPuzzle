export const TYPES = Object.freeze({sudoku:'Sudoku',killersudoku:'Killer Sudoku',futoshiki:'Futoshiki',kenken:'KenKen',latinsquare:'Latin square',diagonallatinsquare:'Diagonal Latin square',pandiagonallatinsquare:'Pandiagonal Latin square',hidato:'Hidato',numbrix:'Numbrix',kakuro:'Kakuro',slitherlink:'Slitherlink'});
export const clone = value => JSON.parse(JSON.stringify(value));
export const isCage = type => ['killersudoku','kenken'].includes(type);
function dimension(n) { if(!Number.isInteger(n)||n<1||n>25) throw Error('Board dimensions must be whole numbers from 1 to 25.');return n;}
export function boxShape(n) { dimension(n); let r=Math.floor(Math.sqrt(n)); while(n%r) r--; return [r,n/r]; }
export function makePuzzle(type='sudoku',rows=9,cols=rows) {
  dimension(rows);dimension(cols);
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
  // Validate BEFORE rendering: tiny/negative box steps or oversized nested
  // arrays otherwise make harmless-looking imports freeze the phone UI.
  for(const key of ['boxRows','boxCols']) if(p[key]!==undefined)dimension(p[key]);
  if(['sudoku','killersudoku'].includes(p.type)) {
    const br=p.boxRows??3,bc=p.boxCols??3;
    if(br*bc!==p.rows||p.rows%br||p.cols%bc)throw Error('Box dimensions must tile the board and contain one of each value.');
  }
  for(const key of ['cages','inequalities','clues']) {
    const limit=(key==='inequalities'?2:1)*p.cells.length;
    if(p[key]!==undefined&&(!Array.isArray(p[key])||p[key].length>limit))throw Error(`Invalid ${key}.`);
  }
  if((p.cages||[]).length&&!isCage(p.type))throw Error('Cages require Killer Sudoku or KenKen.');
  if((p.inequalities||[]).length&&p.type!=='futoshiki')throw Error('Inequalities require Futoshiki.');
  if((p.clues||[]).length&&p.type!=='kakuro')throw Error('Across/down clues require Kakuro.');
  const object=(value,allowed,name)=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error(`Invalid ${name} fields.`);
  };
  const index=i=>Number.isInteger(i)&&i>=0&&i<p.cells.length;
  for(const cage of p.cages||[]) {
    object(cage,['cells','target','op'],'cage');
    if(!Array.isArray(cage.cells)||!cage.cells.length||cage.cells.length>p.cells.length||cage.cells.some(i=>!index(i))||new Set(cage.cells).size!==cage.cells.length)throw Error('Invalid cage cells.');
    // A missing target is an editable OCR placeholder, never accepted by the
    // Python solve boundary. Geometry/coverage are also checked there.
    if(cage.target!=null&&(!Number.isSafeInteger(cage.target)||cage.target<1||cage.target>1e12))throw Error('Invalid cage target.');
    if(cage.op!==undefined&&!['+','-','*','/','='].includes(cage.op))throw Error('Invalid cage operator.');
  }
  for(const q of p.inequalities||[]) {
    object(q,['less','greater'],'inequality');
    if(!index(q.less)||!index(q.greater)||Math.abs(Math.floor(q.less/p.cols)-Math.floor(q.greater/p.cols))+Math.abs(q.less%p.cols-q.greater%p.cols)!==1)throw Error('Inequality cells must share a side.');
  }
  const clueCells=new Set();
  for(const q of p.clues||[]) {
    object(q,['cell','across','down'],'Kakuro clue');
    if(!index(q.cell)||p.cells[q.cell]!=='#'||clueCells.has(q.cell))throw Error('Each Kakuro clue needs a distinct blocked cell.');
    clueCells.add(q.cell);
    for(const direction of ['across','down'])if(q[direction]!=null&&(!Number.isInteger(q[direction])||q[direction]<1||q[direction]>45))throw Error('Kakuro targets must be from 1 to 45.');
  }
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

// Sorted review order, wrapping after the last highlighted cell.
export function nextReviewCell(indices, after=-1) {
  const ordered=[...indices].sort((a,b)=>a-b);
  return ordered.find(i=>i>after)??ordered[0]??null;
}
