import {makePuzzle,classify,conflicts,isCage} from './model.js';
import {threshold,gray} from './geometry.js';
import {mapAtlas,atlasLayout,isGridStroke} from './ocr-map.js';
let library;
function tesseract(){
  if(!library)library=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('./vendor/tesseract/tesseract.min.js',import.meta.url).href;script.onload=()=>resolve(globalThis.Tesseract);script.onerror=()=>{script.remove();library=null;reject(Error('Recognition engine could not load. Go online and retry.'));};document.head.append(script);});
  return library;
}
const aborted=()=>new DOMException('Scan cancelled','AbortError');
export function imageOf(canvas){return canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);}
export function canvasOf(image){const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').putImageData(new ImageData(image.data,image.width,image.height),0,0);return c;}
function fraction(mask,w,h,x,y,rw,rh){let sum=0,n=0;for(let yy=Math.max(0,Math.floor(y));yy<Math.min(h,y+rh);yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(w,x+rw);xx++){sum+=mask[yy*w+xx];n++;}return sum/Math.max(1,n);}
function componentsForCages(mask,w,h,rows,cols,type){
  const cw=w/cols,ch=h/rows,parent=Array.from({length:rows*cols},(_,i)=>i),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  function boundary(r,c,vertical){
    const x=vertical?(c+1)*cw:c*cw+.2*cw,y=vertical?r*ch+.2*ch:(r+1)*ch;
    const band=Math.max(1,Math.min(cw,ch)*.023),offset=Math.min(cw,ch)*.075;
    const strip=d=>vertical?fraction(mask,w,h,x+d-band/2,y,band,ch*.6):fraction(mask,w,h,x,y+d-band/2,cw*.6,band);
    if(type==='killersudoku')return Math.max(strip(-offset),strip(offset))>.19;
    return Math.min(strip(-band*1.2),strip(band*1.2))>.30;
  }
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const i=r*cols+c;
    if(c<cols-1&&!boundary(r,c,true))parent[root(i)]=root(i+1);
    if(r<rows-1&&!boundary(r,c,false))parent[root(i)]=root(i+cols);
  }
  const groups=new Map();for(let i=0;i<parent.length;i++){const k=root(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i);}return [...groups.values()];
}
export class Scanner {
  constructor(){this.epoch=0;this.jobs=new Set();this.ocr=null;}
  cancel(){this.epoch++;for(const job of this.jobs){job.worker.terminate();job.reject(aborted());}this.jobs.clear();if(this.ocr){void this.ocr.terminate();this.ocr=null;}}
  geometry(op,options){
    return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./geometry-worker.js',import.meta.url),{type:'module'}),job={worker,reject};this.jobs.add(job);
      const finish=()=>{worker.terminate();this.jobs.delete(job);};
      worker.onmessage=({data})=>{finish();data.error?reject(Error(data.error)):resolve(data.result);};
      worker.onerror=e=>{finish();reject(Error(e.message||'Image processing failed'));};
      worker.postMessage({id:this.epoch,op,...options});
    });
  }
  detect(canvas){return this.geometry('detect',{image:imageOf(canvas)});}
  async read(canvas,corners,type,rows,cols,onProgress=()=>{}){
    this.cancel();const epoch=this.epoch,check=()=>{if(epoch!==this.epoch)throw aborted();};
    onProgress('Straightening the photograph…',null);
    const {image,meta}=await this.geometry('warp',{image:imageOf(canvas),corners,width:Math.min(1500,cols*100),height:Math.min(1500,rows*100)});check();
    const w=image.width,h=image.height,cw=w/cols,ch=h/rows,mask=threshold(image),g=gray(image),rectified=canvasOf(image);
    const dark=new Uint8Array(g.length);for(let i=0;i<g.length;i++)dark[i]=g[i]<125?1:0;
    const black=Array.from({length:rows*cols},(_,i)=>fraction(dark,w,h,(i%cols+.16)*cw,(Math.floor(i/cols)+.16)*ch,.68*cw,.68*ch)>.48);
    const entries=[];
    function region(kind,cell,x,y,rw,rh,invert=false,other=null){
      x=Math.max(0,Math.round(x));y=Math.max(0,Math.round(y));rw=Math.max(1,Math.min(w-x,Math.round(rw)));rh=Math.max(1,Math.min(h-y,Math.round(rh)));
      let minx=rw,miny=rh,maxx=-1,maxy=-1,ink=0;
      for(let yy=0;yy<rh;yy++)for(let xx=0;xx<rw;xx++){
        const val=invert?g[(y+yy)*w+x+xx]>175:mask[(y+yy)*w+x+xx];
        if(val){minx=Math.min(minx,xx);miny=Math.min(miny,yy);maxx=Math.max(maxx,xx);maxy=Math.max(maxy,yy);ink++;}
      }
      if(ink<Math.max(4,rw*rh*.008)||maxy-miny<Math.max(2,rh*.10))return;
      if(kind==='label'&&(maxy>=rh-2||maxy-miny<3))return;
      if(isGridStroke({kind,width:maxx-minx+1,height:maxy-miny+1,ink,regionWidth:rw,cellHeight:ch}))return;
      if(kind==='hsign'&&(maxx-minx)<(maxy-miny)*.30)return;
      if(kind==='vsign'&&(maxy-miny)<(maxx-minx)*.30)return;
      entries.push({kind,cell,other,x:x+minx,y:y+miny,w:maxx-minx+1,h:maxy-miny+1,invert,text:'',confidence:0});
    }
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const i=r*cols+c;
      if(black[i]&&['auto','kakuro','hidato'].includes(type)){
        if(type!=='hidato'){
          region('across',i,(c+.48)*cw,(r+.04)*ch,.46*cw,.40*ch,true);
          region('down',i,(c+.05)*cw,(r+.55)*ch,.40*cw,.40*ch,true);
        }
      }else region('value',i,(c+.14)*cw,(r+.16)*ch,.72*cw,.72*ch);
      if(type==='auto'||isCage(type))region('label',i,(c+.04)*cw,(r+.015)*ch,.70*cw,.255*ch);
      if(type==='auto'||type==='futoshiki'){
        if(c<cols-1)region('hsign',i,(c+.82)*cw,(r+.25)*ch,.36*cw,.5*ch,false,i+1);
        if(r<rows-1)region('vsign',i,(c+.25)*cw,(r+.82)*ch,.5*cw,.36*ch,false,i+cols);
      }
    }
    if(!entries.length)throw Error('No printed clues found. Adjust the crop, dimensions or lighting.');
    // One bounded atlas call, not separate OCR calls for every cell. The
    // sparse-text mode and character boxes preserve the original clue slots.
    const {tile,columns,rows:atlasRows}=atlasLayout(entries.length),atlas=document.createElement('canvas');atlas.width=columns*tile;atlas.height=atlasRows*tile;
    const ctx=atlas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,atlas.width,atlas.height);
    const bw=canvasOf({width:w,height:h,data:new Uint8ClampedArray(image.data.length)}),bd=bw.getContext('2d').createImageData(w,h);
    for(let i=0;i<mask.length;i++){const v=mask[i]?0:255;bd.data[4*i]=bd.data[4*i+1]=bd.data[4*i+2]=v;bd.data[4*i+3]=255;}bw.getContext('2d').putImageData(bd,0,0);
    entries.forEach((e,i)=>{
      const scale=Math.min(tile*74/112/e.w,tile*72/112/e.h),dw=e.w*scale,dh=e.h*scale,x=(i%columns)*tile+(tile-dw)/2,y=Math.floor(i/columns)*tile+(tile-dh)/2;
      ctx.save();if(e.invert)ctx.filter='invert(1)';ctx.drawImage(e.invert?rectified:bw,e.x,e.y,e.w,e.h,x,y,dw,dh);ctx.restore();
    });
    onProgress('Loading printed-clue recognition…',null);
    const T=await tesseract();check();
    const worker=await T.createWorker('eng',1,{
      workerPath:new URL('./vendor/tesseract/worker.min.js',import.meta.url).href,
      corePath:new URL('./vendor/tesseract-core/',import.meta.url).href,
      langPath:new URL('./vendor/tessdata/',import.meta.url).href.replace(/\/$/,''),
      workerBlobURL:false,
      logger:m=>{if(epoch===this.epoch&&m.status==='recognizing text')onProgress('Reading printed clues…',m.progress);}
    });
    if(epoch!==this.epoch){await worker.terminate();throw aborted();}this.ocr=worker;
    try{
      await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:'0123456789<>^vV+-xX*/=×÷',user_defined_dpi:'300'});check();
      const {data}=await worker.recognize(atlas,{}, {text:true,blocks:true});check();
      const readings=mapAtlas(data,entries.length,columns,tile);
      entries.forEach((e,i)=>{e.text=readings[i].text;e.confidence=readings[i].confidence;});
    }finally{if(this.ocr===worker)this.ocr=null;await worker.terminate();}
    check();
    const valueEntries=entries.filter(e=>e.kind==='value'),values=Array(rows*cols).fill(null),uncertain=new Set();
    for(const e of valueEntries){if(/^\d{1,3}$/.test(e.text))values[e.cell]=+e.text;if(values[e.cell]===null||e.confidence<85)uncertain.add(e.cell);}
    const labels=entries.filter(e=>e.kind==='label'&&/^\d{1,12}[+\-xX*\/÷×=]?$/.test(e.text));
    const signs=entries.filter(e=>['hsign','vsign'].includes(e.kind)&&/^[<>^vV]$/.test(e.text));
    const triangles=entries.filter(e=>['across','down'].includes(e.kind)&&/^\d{1,2}$/.test(e.text));
    const suggested=classify({rows,cols,values,signs:signs.length,labels:labels.length,operators:labels.filter(e=>/[+\-xX*\/÷×=]/.test(e.text)).length,black:black.filter(Boolean).length,triangles:triangles.length,boxes:meta.boxes,dots:!meta.rows&&!meta.cols});
    const chosen=type==='auto'?suggested.type:type,puzzle=makePuzzle(chosen,rows,cols),notes=[];
    const max=chosen==='slitherlink'?4:['hidato','numbrix'].includes(chosen)?rows*cols-(chosen==='hidato'?black.filter(Boolean).length:0):chosen==='kakuro'?9:rows;
    puzzle.cells=values.map((v,i)=>{
      if(black[i]&&['hidato','kakuro'].includes(chosen))return '#';
      if(v!==null&&(v>max||v<(chosen==='slitherlink'?0:1))){uncertain.add(i);return null;}return v;
    });
    if(chosen==='futoshiki')puzzle.inequalities=signs.map(e=>{const smallerFirst=['<','^'].includes(e.text);uncertain.add(e.cell);return {less:smallerFirst?e.cell:e.other,greater:smallerFirst?e.other:e.cell};});
    if(chosen==='kakuro'){
      for(let i=0;i<puzzle.cells.length;i++)if(puzzle.cells[i]==='#'){
        const clue={cell:i};for(const d of ['across','down']){const e=triangles.find(e=>e.cell===i&&e.kind===d);if(e)clue[d]=+e.text;}
        if(clue.across||clue.down)puzzle.clues.push(clue);uncertain.add(i);
      }
    }
    if(isCage(chosen)){
      const areas=componentsForCages(mask,w,h,rows,cols,chosen);
      puzzle.cages=areas.map(cells=>{
        const matches=labels.filter(e=>cells.includes(e.cell)).sort((a,b)=>a.cell-b.cell),text=matches[0]?.text||'',target=Number.parseInt(text,10),op=chosen==='killersudoku'?'+':text.match(/[+\-xX*\/÷×=]/)?.[0]||'+';
        if(matches.length!==1)notes.push(`A cage covering ${cells.length} cells needs its boundary/target checked.`);
        cells.forEach(i=>uncertain.add(i));
        return {cells,target:Number.isFinite(target)?target:null,op:op.replace(/[xX×]/,'*').replace('÷','/')};
      });
    }
    conflicts(puzzle).forEach(i=>uncertain.add(i));
    const needsReview=(type==='auto'&&suggested.review)||isCage(chosen)||['futoshiki','kakuro','hidato','numbrix','slitherlink'].includes(chosen);
    if(type==='auto')notes.unshift(suggested.reason);
    if(isCage(chosen))notes.unshift('Cage recognition is experimental. Check the entire partition: missing boundaries can merge cages.');
    return {puzzle,uncertain:[...uncertain],needsReview,notes:[...new Set(notes)].slice(0,8),rectified,entries};
  }
}
