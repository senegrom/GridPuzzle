import {TYPES,makePuzzle,demo,clone,checkShape,conflicts,isCage} from './model.js';
import {Scanner,canvasOf,imageOf} from './scanner.js';
import {homography,project,validQuad} from './geometry.js';

const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg',scanner=new Scanner();
const state={puzzle:makePuzzle(),uncertain:new Set(),needsReview:false,notes:[],result:null,solution:0,photo:null,rectified:null,corners:null,photoRows:0,photoCols:0,view:'board',selected:[],history:[]};
let worker=null,jobId=0,busy=false,timer=null,deadline=null,started=0,stream=null,cameraEpoch=0,editing=0,drag=-1,focused=0;
const storage={get:key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}},set:(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Private/storage-full mode must not break solving. */}}};
for(const [value,label] of Object.entries(TYPES)){const option=document.createElement('option');option.value=value;option.textContent=label;$('puzzle-type').append(option);}
const prefs=storage.get('gridpuzzle-settings-v1');
if(prefs){if(prefs.type==='auto'||Object.hasOwn(TYPES,prefs.type))$('puzzle-type').value=prefs.type;for(const id of ['auto-capture','auto-solve'])if(typeof prefs[id]==='boolean')$(id).checked=prefs[id];if(['0','30','90','300'].includes(prefs.limit))$('time-limit').value=prefs.limit;}
function savePrefs(){storage.set('gridpuzzle-settings-v1',{type:$('puzzle-type').value,'auto-capture':$('auto-capture').checked,'auto-solve':$('auto-solve').checked,limit:$('time-limit').value});}
for(const id of ['puzzle-type','auto-capture','auto-solve','time-limit'])$(id).addEventListener('change',savePrefs);
function status(text,detail='',kind='info',progress=null){
  $('status').className=`status ${kind}`;$('status-text').textContent=text;$('status-detail').textContent=detail;
  $('progress').hidden=!busy;if(progress===null)$('progress').removeAttribute('value');else $('progress').value=progress;
}
function fail(error){if(error?.name!=='AbortError')status(error?.message||String(error),'Nothing was uploaded or sent to a remote solver.','error');}
function remember(){state.history.push({puzzle:clone(state.puzzle),uncertain:[...state.uncertain],needsReview:state.needsReview,notes:[...state.notes]});if(state.history.length>30)state.history.shift();}
function persist(){storage.set('gridpuzzle-puzzle-v1',state.puzzle);}
function stopTask(message=null){
  jobId++;scanner.cancel();if(busy&&worker){worker.terminate();worker=null;}busy=false;clearInterval(timer);clearTimeout(deadline);timer=deadline=null;$('stop').hidden=true;$('solve').disabled=false;$('progress').hidden=true;$('status').setAttribute('aria-busy','false');
  if(message)status(message,'Search unfinished. No claim about uniqueness or impossibility has been made.','warning');
}
function invalidate(){stopTask();state.result=null;state.solution=0;state.view='board';}
function begin(){stopTask();busy=true;started=performance.now();$('stop').hidden=false;$('solve').disabled=true;$('status').setAttribute('aria-busy','true');timer=setInterval(()=>{$('status-detail').textContent=`${((performance.now()-started)/1000).toFixed(1)} seconds elapsed · Stop cancels this task.`;},500);return jobId;}
function finish(){busy=false;clearInterval(timer);clearTimeout(deadline);timer=deadline=null;$('stop').hidden=true;$('solve').disabled=false;$('progress').hidden=true;$('status').setAttribute('aria-busy','false');}
function mutate(fn){remember();invalidate();fn();persist();render();}
function normalized(p){checkShape(p);return {...clone(p),cages:clone(p.cages||[]),inequalities:clone(p.inequalities||[]),clues:clone(p.clues||[])};}
export function loadPuzzle(payload){const p=normalized(payload);remember();invalidate();state.puzzle=p;state.uncertain.clear();state.needsReview=false;state.notes=[];state.photo=state.rectified=state.corners=null;$('photo-panel').hidden=true;$('puzzle-type').value=p.type;state.selected=[];persist();render();status('Puzzle loaded.',`${TYPES[p.type]} · Tap any cell to edit its printed clue.`);}
export function getState(){return {puzzle:clone(state.puzzle),result:clone(state.result),uncertain:[...state.uncertain],busy};}
function svg(tag,attrs={},text=null){const node=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));if(text!==null)node.textContent=String(text);return node;}
function drawBoard(){
  const p=state.puzzle,board=$('board'),size=72,margin=5,sol=state.result?.solutions?.[state.solution],bad=conflicts(p);
  board.replaceChildren();board.setAttribute('viewBox',`-${margin} -${margin} ${p.cols*size+2*margin} ${p.rows*size+2*margin}`);
  const cages=new Map();p.cages.forEach((c,k)=>c.cells.forEach(i=>cages.set(i,k)));
  for(let i=0;i<p.cells.length;i++){
    const r=Math.floor(i/p.cols),c=i%p.cols,x=c*size,y=r*size,given=p.cells[i],value=sol?.cells[i]??given;
    const classes=['board-cell'];if(given==='#')classes.push('blocked');else if(given===null&&Number.isInteger(value))classes.push('answer');if(state.uncertain.has(i))classes.push('uncertain');if(bad.has(i))classes.push('conflict');if(state.selected.includes(i))classes.push('selected');
    const g=svg('g',{'class':classes.join(' '),'data-cell':i,role:'button',tabindex:i===focused?0:-1,'aria-label':`Row ${r+1}, column ${c+1}: ${given===null?'blank':given==='#'?'blocked':given}${state.uncertain.has(i)?', check reading':''}`});
    g.append(svg('rect',{x,y,width:size,height:size,class:'cell-hit'}));
    if(given==='#'&&p.type==='kakuro'){
      const clue=p.clues.find(q=>q.cell===i);if(clue){g.append(svg('path',{d:`M${x},${y}l72,72`,stroke:'#829b91'}));if(clue.across!=null)g.append(svg('text',{x:x+51,y:y+24,class:'kakuro-clue'},clue.across));if(clue.down!=null)g.append(svg('text',{x:x+21,y:y+59,class:'kakuro-clue'},clue.down));}
    }else if(Number.isInteger(value))g.append(svg('text',{x:x+36,y:y+47,style:`font-size:${value>=100?22:30}px`},value));
    board.append(g);
  }
  if(['sudoku','killersudoku'].includes(p.type)&&Number.isInteger(p.boxRows)&&Number.isInteger(p.boxCols)&&p.boxRows>0&&p.boxCols>0){
    for(let r=0;r<=p.rows;r+=p.boxRows)board.append(svg('path',{d:`M0 ${r*size}H${p.cols*size}`,class:'box-line'}));
    for(let c=0;c<=p.cols;c+=p.boxCols)board.append(svg('path',{d:`M${c*size} 0V${p.rows*size}`,class:'box-line'}));
  }
  if(isCage(p.type))p.cages.forEach((cage,k)=>{
    for(const i of cage.cells){const r=Math.floor(i/p.cols),c=i%p.cols,x=c*size,y=r*size;let d='';if(r===0||cages.get(i-p.cols)!==k)d+=`M${x+4} ${y+4}h64`;if(c===p.cols-1||cages.get(i+1)!==k)d+=`M${x+68} ${y+4}v64`;if(r===p.rows-1||cages.get(i+p.cols)!==k)d+=`M${x+4} ${y+68}h64`;if(c===0||cages.get(i-1)!==k)d+=`M${x+4} ${y+4}v64`;board.append(svg('path',{d,class:'cage-line','stroke-dasharray':p.type==='killersudoku'?'3 3':'none'}));}
    const i=Math.min(...cage.cells),text=`${cage.target??'?'}${p.type==='kenken'?({'*':'×','/':'÷'}[cage.op]||cage.op||'+'):''}`;
    board.append(svg('text',{x:(i%p.cols)*size+8,y:Math.floor(i/p.cols)*size+17,'font-size':13,fill:'#45665e','pointer-events':'none'},text));
  });
  for(const q of p.inequalities){const ar=Math.floor(q.less/p.cols),ac=q.less%p.cols,br=Math.floor(q.greater/p.cols),bc=q.greater%p.cols,x=(ac+bc+1)*size/2,y=(ar+br+1)*size/2;
    board.append(svg('rect',{x:x-10,y:y-13,width:20,height:26,fill:'#fff','pointer-events':'none'}));board.append(svg('text',{x,y:y+8,class:'inequality'},ar===br?(ac<bc?'<':'>'):(ar<br?'⌃':'⌄')));
  }
  if(p.type==='slitherlink'){
    for(const [orientation,r,c] of sol?.edges||[])board.append(svg('line',{x1:c*size,y1:r*size,x2:(c+(orientation==='H'?1:0))*size,y2:(r+(orientation==='V'?1:0))*size,class:'loop-edge'}));
    for(let r=0;r<=p.rows;r++)for(let c=0;c<=p.cols;c++)board.append(svg('circle',{cx:c*size,cy:r*size,r:3,fill:'#173536','pointer-events':'none'}));
  }
}
function canOverlay(){return !!(state.photo&&state.corners&&state.result?.solutions?.length&&state.photoRows===state.puzzle.rows&&state.photoCols===state.puzzle.cols);}
function drawOverlay(){
  if(!canOverlay())return;const out=$('solution-photo'),ctx=out.getContext('2d'),p=state.puzzle,sol=state.result.solutions[state.solution];out.width=state.photo.width;out.height=state.photo.height;ctx.drawImage(state.photo,0,0);
  const m=homography(state.corners),point=(r,c)=>project(m,c/p.cols,r/p.rows);
  ctx.strokeStyle='#078772';ctx.lineWidth=Math.max(3,out.width/180);ctx.lineCap='round';
  if(p.type==='slitherlink')for(const [o,r,c] of sol.edges){const a=point(r,c),b=point(r+(o==='V'?1:0),c+(o==='H'?1:0));ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  else for(let i=0;i<p.cells.length;i++)if(p.cells[i]===null&&Number.isInteger(sol.cells[i])){
    const r=Math.floor(i/p.cols),c=i%p.cols,a=point(r+.5,c+.5),b=point(r+.5,c+1.1),height=point(r+1,c+.5),font=Math.max(10,Math.min(Math.hypot(a.x-b.x,a.y-b.y),Math.hypot(a.x-height.x,a.y-height.y))*1.05);
    ctx.font=`650 ${font}px -apple-system,Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=Math.max(2,font*.10);ctx.strokeStyle='#ffffffee';ctx.strokeText(String(sol.cells[i]),a.x,a.y);ctx.fillStyle='#067c6b';ctx.fillText(String(sol.cells[i]),a.x,a.y);
  }
}
function render(){
  const p=state.puzzle;$('board-meta').textContent=`${TYPES[p.type]} · ${p.rows} × ${p.cols} · ${p.cells.filter(Number.isInteger).length} printed clues`;
  $('rows').value=p.rows;$('cols').value=p.cols;$('box-rows').value=p.boxRows||boxDefault(p.rows)[0];$('box-cols').value=p.boxCols||boxDefault(p.rows)[1];
  $('box-fields').hidden=!['sudoku','killersudoku'].includes(p.type);$('undo').disabled=!state.history.length;
  for(const option of $('edit-tool').options)option.disabled=(option.value==='cage'&&!isCage(p.type))||(option.value==='inequality'&&p.type!=='futoshiki');
  if($('edit-tool').selectedOptions[0]?.disabled)$('edit-tool').value='value';
  $('cage-editor').hidden=$('edit-tool').value!=='cage';$('inequality-editor').hidden=$('edit-tool').value!=='inequality';$('cage-op').disabled=p.type==='killersudoku';
  $('json-data').value=JSON.stringify(p,null,2);drawBoard();
  const overlay=canOverlay();$('photo-view').disabled=!overlay;$('save-photo').hidden=!overlay;$('show-crop').hidden=!state.photo;
  if(!overlay)state.view='board';$('board-scroll').hidden=state.view==='photo';$('solution-photo').hidden=state.view!=='photo';$('clean-view').setAttribute('aria-pressed',String(state.view==='board'));$('photo-view').setAttribute('aria-pressed',String(state.view==='photo'));if(overlay)drawOverlay();
  $('next-solution').hidden=(state.result?.solutions?.length||0)<2;
  const review=state.uncertain.size||state.needsReview;$('review-note').hidden=!review;
  $('review-note').textContent=[state.uncertain.size?`${state.uncertain.size} cells need checking. Tap a highlighted cell to compare it with the photograph.`:'Confirm the puzzle type and structural clues.',...state.notes].join('\n');
  $('solve').textContent=review?'Check & solve →':'Solve puzzle →';
}
function boxDefault(n){let a=Math.floor(Math.sqrt(n));while(n%a)a--;return [a,n/a];}
function openCell(i){
  stopTask();editing=i;focused=i;const p=state.puzzle,r=Math.floor(i/p.cols),c=i%p.cols;$('cell-title').textContent=`Row ${r+1} · Column ${c+1}`;$('cell-value').value=Number.isInteger(p.cells[i])?p.cells[i]:'';$('blocked-cell').checked=p.cells[i]==='#';$('block-option').hidden=!['hidato','kakuro'].includes(p.type);$('cell-error').textContent='';
  const clue=p.clues.find(q=>q.cell===i);$('across-value').value=clue?.across??'';$('down-value').value=clue?.down??'';blockInputs();
  $('clue-crop').hidden=!(state.rectified&&state.photoRows===p.rows&&state.photoCols===p.cols);
  if(!$('clue-crop').hidden){const out=$('clue-crop'),ctx=out.getContext('2d'),cw=state.rectified.width/p.cols,ch=state.rectified.height/p.rows;ctx.fillStyle='#fff';ctx.fillRect(0,0,180,180);ctx.drawImage(state.rectified,c*cw,r*ch,cw,ch,0,0,180,180);}
  $('cell-dialog').showModal();$('cell-value').focus();$('cell-value').select();
}
function blockInputs(){$('cell-value').disabled=$('blocked-cell').checked;$('kakuro-inputs').hidden=state.puzzle.type!=='kakuro'||!$('blocked-cell').checked;}
$('blocked-cell').onchange=blockInputs;
function numberInput(id){const text=$(id).value.trim();if(!text)return null;if(!/^\d{1,12}$/.test(text))throw Error('Use a whole number, or leave the field blank.');return Number(text);}
function saveCell(){
  try{
    const next=clone(state.puzzle),blocked=!$('block-option').hidden&&$('blocked-cell').checked;
    next.cells[editing]=blocked?'#':numberInput('cell-value');next.clues=next.clues.filter(q=>q.cell!==editing);
    if(blocked&&next.type==='kakuro'){const across=numberInput('across-value'),down=numberInput('down-value');if((across!==null&&(across<1||across>45))||(down!==null&&(down<1||down>45)))throw Error('Kakuro targets must be from 1 to 45.');if(across!==null||down!==null)next.clues.push({cell:editing,across,down});}
    checkShape(next);mutate(()=>{state.puzzle=next;state.uncertain.delete(editing);});$('cell-dialog').close();status('Clue saved.','The previous solution has been cleared.');
  }catch(e){$('cell-error').textContent=e.message;}
}
$('cell-form').onsubmit=e=>{e.preventDefault();saveCell();};$('clear-cell').onclick=()=>{$('cell-value').value='';$('blocked-cell').checked=false;$('across-value').value=$('down-value').value='';saveCell();};$('close-cell').onclick=()=>$('cell-dialog').close();
function cellAction(i){const tool=$('edit-tool').value;if(tool==='value')return openCell(i);stopTask();if(state.selected.includes(i))state.selected=state.selected.filter(x=>x!==i);else{if(tool==='inequality'&&state.selected.length===2)state.selected=[];state.selected.push(i);}drawBoard();status(`${state.selected.length} cells selected.`,tool==='cage'?'Enter the target and save the cage.':'Select the smaller cell first, then the larger adjacent cell.');}
$('board').onclick=e=>{const cell=e.target.closest('[data-cell]');if(cell)cellAction(Number(cell.dataset.cell));};
$('board').onkeydown=e=>{const cell=e.target.closest('[data-cell]');if(!cell)return;const i=Number(cell.dataset.cell);if(['Enter',' '].includes(e.key)){e.preventDefault();cellAction(i);return;}const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-state.puzzle.cols,ArrowDown:state.puzzle.cols}[e.key];if(delta){e.preventDefault();focused=Math.max(0,Math.min(state.puzzle.cells.length-1,i+delta));drawBoard();$('board').querySelector(`[data-cell="${focused}"]`).focus();}};
$('edit-tool').onchange=()=>{state.selected=[];render();};$('clear-selection').onclick=()=>{state.selected=[];drawBoard();};
$('save-cage').onclick=()=>{try{const target=numberInput('cage-target');if(!target||!state.selected.length)throw Error('Select cage cells and enter a positive target.');const cells=[...state.selected],op=state.puzzle.type==='killersudoku'?'+':$('cage-op').value;mutate(()=>{state.puzzle.cages=state.puzzle.cages.filter(q=>!q.cells.some(i=>cells.includes(i)));state.puzzle.cages.push({cells:cells.sort((a,b)=>a-b),target,op});cells.forEach(i=>state.uncertain.delete(i));state.selected=[];});status('Cage saved.','Every cell must belong to exactly one cage before solving.');}catch(e){fail(e);}};
$('remove-cage').onclick=()=>mutate(()=>{state.puzzle.cages=state.puzzle.cages.filter(q=>!q.cells.some(i=>state.selected.includes(i)));state.selected=[];});
$('save-inequality').onclick=()=>{try{if(state.selected.length!==2)throw Error('Select the smaller cell and its larger neighbour.');const [less,greater]=state.selected,p=state.puzzle;if(Math.abs(Math.floor(less/p.cols)-Math.floor(greater/p.cols))+Math.abs(less%p.cols-greater%p.cols)!==1)throw Error('Inequality cells must share a side.');mutate(()=>{p.inequalities=p.inequalities.filter(q=>![less,greater].includes(q.less)||![less,greater].includes(q.greater));p.inequalities.push({less,greater});state.selected=[];});}catch(e){fail(e);}};
$('remove-inequality').onclick=()=>mutate(()=>{state.puzzle.inequalities=state.puzzle.inequalities.filter(q=>!(state.selected.includes(q.less)&&state.selected.includes(q.greater)));state.selected=[];});
$('undo').onclick=()=>{const previous=state.history.pop();if(!previous)return;invalidate();state.puzzle=previous.puzzle;state.uncertain=new Set(previous.uncertain);state.needsReview=previous.needsReview;state.notes=previous.notes;state.selected=[];persist();render();status('Last edit undone.');};
$('stop').onclick=()=>stopTask('Stopped.');
function requestSolve(){try{checkShape(state.puzzle);if(state.uncertain.size||state.needsReview){$('confirm-text').textContent=`${TYPES[state.puzzle.type]} · ${state.puzzle.rows} × ${state.puzzle.cols}. ${state.uncertain.size} cells were highlighted for review.`;$('confirm-dialog').showModal();}else solveNow();}catch(e){fail(e);}}
function solveNow(){
  try{checkShape(state.puzzle);}catch(e){fail(e);return;}
  state.uncertain.clear();state.needsReview=false;state.notes=[];state.result=null;state.solution=0;state.view='board';render();const id=begin();
  if(!worker)worker=new Worker(new URL('./solver-worker.js',import.meta.url),{type:'module'});
  deadline=setTimeout(()=>{if(id===jobId)stopTask('Runtime loading timed out. Go online and retry.');},180000);
  worker.onmessage=({data:m})=>{
    if(m.id!==jobId)return;
    if(m.type==='status'){
      status(m.message,'Stop cancels this task.');
      if(m.message.startsWith('Solving')){clearTimeout(deadline);const seconds=Number($('time-limit').value);if(seconds>0)deadline=setTimeout(()=>{if(id===jobId)stopTask('Search limit reached. Increase the limit to continue from a fresh search.');},seconds*1000);}
      return;
    }
    finish();state.result=m.result;render();const r=m.result;
    if(r.status==='unique')status('Solved · unique solution',`Completed and validated in ${r.elapsed.toFixed(2)} seconds. Original clues are preserved.`);
    else if(r.status==='multiple')status('More than one solution',`At least two valid solutions exist. Check for a missed clue or an incorrect puzzle type. Use “Other solution” to compare.`,'warning');
    else if(r.status==='no-solution')status('No solution to these clues.','Check the transcription, puzzle type and structural clues. This does not prove the photograph is wrong.','warning');
    else status(r.status==='invalid'?'Check the puzzle data.':'The solver could not finish.',r.message||'Please retry.','error');
    $('status').dataset.result=r.status;
  };
  worker.onerror=e=>{if(id!==jobId)return;worker.terminate();worker=null;finish();status('The solver stopped unexpectedly.',e.message||'The phone may have run out of memory. Retry with other tabs closed.','error');};
  status('Starting the on-device solver…','The first load downloads Python.');worker.postMessage({id,puzzle:clone(state.puzzle)});
}
$('solve').onclick=requestSolve;$('confirm-solve').onclick=()=>{$('confirm-dialog').close();solveNow();};$('confirm-back').onclick=()=>$('confirm-dialog').close();
$('next-solution').onclick=()=>{state.solution=(state.solution+1)%state.result.solutions.length;render();};$('clean-view').onclick=()=>{state.view='board';render();};$('photo-view').onclick=()=>{state.view='photo';render();};
$('example').onclick=()=>{try{loadPuzzle(demo($('puzzle-type').value==='auto'?'sudoku':$('puzzle-type').value));}catch(e){fail(e);}};
$('new-board').onclick=()=>{try{const type=$('puzzle-type').value==='auto'?'sudoku':$('puzzle-type').value,n=['sudoku','killersudoku'].includes(type)?9:type==='kenken'?6:5;loadPuzzle(makePuzzle(type,n));}catch(e){fail(e);}};
$('apply-layout').onclick=()=>{try{const rows=Number($('rows').value),cols=Number($('cols').value),type=$('puzzle-type').value==='auto'?state.puzzle.type:$('puzzle-type').value;const next=makePuzzle(type,rows,cols);next.boxRows=Number($('box-rows').value);next.boxCols=Number($('box-cols').value);checkShape(next);if(type===state.puzzle.type&&rows===state.puzzle.rows&&cols===state.puzzle.cols){mutate(()=>{state.puzzle.boxRows=next.boxRows;state.puzzle.boxCols=next.boxCols;});}else if(confirm('Changing the board type or dimensions clears the existing clues and structural constraints. Continue?'))loadPuzzle(next);}catch(e){fail(e);}};
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
$('export-json').onclick=()=>download(new Blob([JSON.stringify(state.puzzle,null,2)],{type:'application/json'}),`gridpuzzle-${state.puzzle.type}.json`);
$('save-photo').onclick=()=>{drawOverlay();$('solution-photo').toBlob(blob=>{if(blob)download(blob,'gridpuzzle-solution.png');});};
$('import-json').onclick=()=>$('json-file').click();$('json-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>200000)throw Error('Puzzle files must be smaller than 200 KB.');loadPuzzle(JSON.parse(await file.text()));}catch(error){fail(error);}finally{e.target.value='';}};
$('apply-json').onclick=()=>{try{if($('json-data').value.length>200000)throw Error('Puzzle data is too large.');loadPuzzle(JSON.parse($('json-data').value));}catch(e){fail(e);}};

function stopCamera(){cameraEpoch++;if(stream)for(const track of stream.getTracks())track.stop();stream=null;$('video').srcObject=null;$('camera-panel').hidden=true;}
function frame(video,max=1600){if(!video.videoWidth)throw Error('The camera is not ready yet.');const scale=Math.min(1,max/Math.max(video.videoWidth,video.videoHeight)),c=document.createElement('canvas');c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);c.getContext('2d').drawImage(video,0,0,c.width,c.height);return c;}
async function openCamera(){
  stopTask();stopCamera();const epoch=cameraEpoch;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Live camera access needs HTTPS and a compatible browser.');
    status('Opening camera…','Please allow camera access.');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}}});
    if(epoch!==cameraEpoch){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;$('camera-panel').hidden=false;$('video').srcObject=stream;await $('video').play();$('camera-panel').scrollIntoView({behavior:'smooth',block:'start'});status('Camera ready.','Capture manually or hold a clear grid steady.');
    let stable=0,previous=null;
    const loop=async()=>{
      if(epoch!==cameraEpoch||!stream)return;
      try{
        if($('auto-capture').checked){const small=frame($('video'),480),found=await scanner.detect(small);if(epoch!==cameraEpoch)return;
          const movement=previous?Math.max(...found.corners.map((p,i)=>Math.hypot(p.x-previous.corners[i].x,p.y-previous.corners[i].y))):Infinity;
          if(found.confidence>.85&&found.sharpness>100&&movement<small.width*.018&&found.rows===previous?.rows&&found.cols===previous?.cols)stable++;else stable=0;
          previous=found;$('camera-help').textContent=stable?`Grid found. Hold steady… ${stable}/3`:'Keep the entire grid in view. Hold steady or tap Capture.';
          if(stable>=3){takePhoto(true);return;}
        }
      }catch(error){if(error.name!=='AbortError')$('camera-help').textContent='Automatic capture is unavailable. Tap Capture to continue.';}
      if(epoch===cameraEpoch)setTimeout(loop,800);
    };setTimeout(loop,900);
  }catch(e){if(epoch!==cameraEpoch)return;stopCamera();$('native-camera').hidden=false;status('Live camera could not open.',`${e.name==='NotAllowedError'?'Camera permission was denied.':e.message} Choose a photo or use the phone’s camera app instead.`,'warning');}
}
$('camera').onclick=openCamera;$('close-camera').onclick=stopCamera;
function takePhoto(auto=false){try{const canvas=frame($('video'));stopCamera();void acceptPhoto(canvas,auto);}catch(e){fail(e);}}
$('take-photo').onclick=()=>takePhoto();$('choose-photo').onclick=()=>$('photo-file').click();$('native-camera').onclick=()=>$('native-file').click();
async function decodeFile(file){
  if(file.size>30*1024*1024)throw Error('Please choose a photo smaller than 30 MB.');
  const url=URL.createObjectURL(file);
  try{const img=new Image();img.src=url;await img.decode();if(!img.naturalWidth||!img.naturalHeight)throw Error('The image is empty.');const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c;}finally{URL.revokeObjectURL(url);}
}
for(const id of ['photo-file','native-file'])$(id).onchange=async e=>{const file=e.target.files[0];if(!file)return;stopCamera();stopTask();const epoch=jobId;try{const canvas=await decodeFile(file);if(epoch===jobId)await acceptPhoto(canvas);}catch(error){fail(error);}finally{e.target.value='';}};
function drawCrop(){
  if(!state.photo||!state.corners)return;const out=$('crop-canvas'),ctx=out.getContext('2d');out.width=state.photo.width;out.height=state.photo.height;ctx.drawImage(state.photo,0,0);const radius=Math.max(15,out.width/32);
  ctx.beginPath();state.corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.strokeStyle='#0cbb94';ctx.lineWidth=Math.max(3,out.width/220);ctx.stroke();
  state.corners.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fillStyle='#123b3b';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=radius/10;ctx.stroke();ctx.fillStyle='#fff';ctx.font=`bold ${radius}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(i+1,p.x,p.y);});
}
async function acceptPhoto(canvas,auto=false){
  invalidate();state.photo=canvas;state.rectified=null;state.corners=null;state.photoRows=state.photoCols=0;state.result=null;$('photo-panel').hidden=false;render();const id=begin();status('Finding the grid…','Photo processing stays on this device.');
  try{const found=await scanner.detect(canvas);if(id!==jobId)return;state.corners=found.corners;finish();if(found.rows&&found.cols){$('rows').value=found.rows;$('cols').value=found.cols;const b=boxDefault(found.rows);$('box-rows').value=b[0];$('box-cols').value=b[1];}drawCrop();status(found.confidence>.8?'Grid found.':'Set the four crop corners.',found.rows?`Detected ${found.rows} × ${found.cols}. Check the corners, then read the puzzle.`:'Drag the numbered handles. Set rows and columns in Grid size & settings.');$('photo-panel').scrollIntoView({block:'start',behavior:'smooth'});if(auto&&found.confidence>.85)await readPhoto();}catch(e){if(id===jobId){finish();fail(e);}}
}
$('detect-photo').onclick=()=>{if(state.photo)void acceptPhoto(state.photo);};
$('rotate-photo').onclick=()=>{if(!state.photo)return;const c=document.createElement('canvas');c.width=state.photo.height;c.height=state.photo.width;const ctx=c.getContext('2d');ctx.translate(c.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(state.photo,0,0);void acceptPhoto(c);};
$('hide-photo').onclick=()=>$('photo-panel').hidden=true;$('show-crop').onclick=()=>{$('photo-panel').hidden=false;drawCrop();$('photo-panel').scrollIntoView({block:'start',behavior:'smooth'});};
$('crop-canvas').style.maxHeight='none';$('crop-canvas').tabIndex=0;$('crop-canvas').title='Drag corners, or press 1–4 to select a corner and use arrow keys.';
function cropPoint(e){const b=$('crop-canvas').getBoundingClientRect();return {x:(e.clientX-b.left)*$('crop-canvas').width/b.width,y:(e.clientY-b.top)*$('crop-canvas').height/b.height};}
$('crop-canvas').onpointerdown=e=>{if(!state.corners)return;const pt=cropPoint(e),dist=state.corners.map(p=>Math.hypot(p.x-pt.x,p.y-pt.y));drag=dist.indexOf(Math.min(...dist));if(dist[drag]>state.photo.width*.15){drag=-1;return;}stopTask();$('crop-canvas').setPointerCapture(e.pointerId);e.preventDefault();};
$('crop-canvas').onpointermove=e=>{if(drag<0)return;const pt=cropPoint(e);state.corners[drag]={x:Math.max(0,Math.min(state.photo.width-1,pt.x)),y:Math.max(0,Math.min(state.photo.height-1,pt.y))};state.rectified=null;state.photoRows=state.photoCols=0;drawCrop();};
$('crop-canvas').onpointerup=$('crop-canvas').onpointercancel=()=>{drag=-1;};
let keyboardCorner=0;$('crop-canvas').onkeydown=e=>{if(!state.corners)return;if(/^[1-4]$/.test(e.key)){keyboardCorner=Number(e.key)-1;return;}const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(delta){e.preventDefault();stopTask();const p=state.corners[keyboardCorner],step=e.shiftKey?10:1;p.x=Math.max(0,Math.min(state.photo.width-1,p.x+delta[0]*step));p.y=Math.max(0,Math.min(state.photo.height-1,p.y+delta[1]*step));state.photoRows=state.photoCols=0;drawCrop();}};
async function readPhoto(){
  if(!state.photo||!state.corners)return;
  const rows=Number($('rows').value),cols=Number($('cols').value),type=$('puzzle-type').value;
  if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||rows>25||cols>25){fail(Error('Set rows and columns to whole numbers from 1 to 25.'));return;}
  if(!validQuad(state.corners,state.photo.width,state.photo.height)){fail(Error('The crop corners must surround the grid clockwise without crossing.'));return;}
  const id=begin();state.result=null;
  try{
    const found=await scanner.read(state.photo,state.corners,type,rows,cols,(text,p)=>{if(id===jobId)status(text,'', 'info',p);});if(id!==jobId)return;finish();remember();state.puzzle=found.puzzle;state.uncertain=new Set(found.uncertain);state.needsReview=found.needsReview;state.notes=found.notes;state.rectified=found.rectified;state.photoRows=rows;state.photoCols=cols;state.selected=[];
    if(['sudoku','killersudoku'].includes(state.puzzle.type)){state.puzzle.boxRows=Number($('box-rows').value);state.puzzle.boxCols=Number($('box-cols').value);}
    persist();render();$('photo-panel').hidden=true;status('Puzzle read.',`${TYPES[state.puzzle.type]} suggested. Check highlighted cells and the puzzle rules.`);$('board-title').scrollIntoView({behavior:'smooth',block:'start'});
    if($('auto-solve').checked&&!state.uncertain.size&&!state.needsReview&&state.puzzle.cells.some(Number.isInteger))solveNow();
  }catch(e){if(id===jobId){finish();fail(e);}}
}
$('read-photo').onclick=()=>void readPhoto();
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});window.addEventListener('pagehide',()=>{stopCamera();stopTask();if(worker)worker.terminate();});

function offlineMessage(worker,type){return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timeout=setTimeout(()=>{channel.port1.close();reject(Error('Offline preparation did not finish. Go online and retry.'));},300000);channel.port1.onmessage=({data:m})=>{if(m.progress!==undefined)$('offline-state').textContent=`Downloading offline assets: ${m.progress} / ${m.total}`;if(m.done||m.error){clearTimeout(timeout);channel.port1.close();m.error?reject(Error(m.error)):resolve(m);}};worker.postMessage({type},[channel.port2]);});}
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').then(async registration=>{
    const ready=await navigator.serviceWorker.ready;
    $('prepare-offline').onclick=async()=>{const button=$('prepare-offline');button.disabled=true;try{await offlineMessage(ready.active,'PREPARE_OFFLINE');$('offline-state').textContent='Offline assets are ready on this device. Browser storage can still be cleared or evicted.';}catch(e){$('offline-state').textContent=e.message;}finally{button.disabled=false;}};
    offlineMessage(ready.active,'OFFLINE_STATUS').then(m=>{if(m.ready)$('offline-state').textContent='Offline assets are ready on this device.';}).catch(()=>{});
    const offerUpdate=()=>{if(registration.waiting){$('update-app').hidden=false;$('update-app').onclick=()=>{registration.waiting.postMessage({type:'ACTIVATE'});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});};}};offerUpdate();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',offerUpdate));
  }).catch(e=>{$('offline-state').textContent=`Offline caching unavailable: ${e.message}`;});
}else{$('prepare-offline').disabled=true;$('offline-state').textContent='This browser does not support offline caching.';}
try{const saved=storage.get('gridpuzzle-puzzle-v1');if(saved)state.puzzle=normalized(saved);}catch{/* Ignore malformed/old autosaves. */}
render();$('build-label').textContent='Browser scanner · __BUILD_ID__';document.body.dataset.ready='true';
