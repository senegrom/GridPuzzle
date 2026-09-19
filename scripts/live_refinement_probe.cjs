const {serve,engines,main}=require('./harness.cjs');
async function probe(){
 const {Scanner}=await import('./scanner.js');
 const {gridAnchor,matchGrid}=await import('./live-registration.js');
 const {gridQuality}=await import('./scan-quality.js');
 const cells=[null,8,null,null,null,null,9,null,null,null,null,null,7,null,null,1,null,null,null,null,6,null,null,2,null,null,4,7,5,null,null,null,9,null,null,null,null,null,null,null,null,null,null,null,6,null,null,9,null,4,8,null,null,3,null,4,8,null,null,null,null,3,null,null,null,null,null,1,null,null,null,null,null,3,null,5,null,null,8,null,null];
 const canvas=document.createElement('canvas');canvas.width=720;canvas.height=960;const ctx=canvas.getContext('2d');
 function paint(){ctx.fillStyle='#edf1f5';ctx.fillRect(0,0,720,960);for(let n=0;n<=9;n++){ctx.strokeStyle=n%3?'#a5aab3':'#343c43';ctx.lineWidth=n%3?1:3;ctx.beginPath();ctx.moveTo(60+n*600/9,200);ctx.lineTo(60+n*600/9,800);ctx.moveTo(60,200+n*600/9);ctx.lineTo(660,200+n*600/9);ctx.stroke();}ctx.fillStyle='#24282c';ctx.font='40px Arial';ctx.textAlign='center';ctx.textBaseline='middle';cells.forEach((v,k)=>{if(v!==null)ctx.fillText(String(v),60+(k%9+.5)*600/9,200+(Math.floor(k/9)+.5)*600/9);});}
 paint();const clean=ctx.getImageData(0,0,720,960),corners=[{x:60,y:200},{x:660,y:200},{x:660,y:800},{x:60,y:800}],sharpAnchor=gridAnchor(clean,corners,9,9),sharpQuality=gridQuality(clean,corners,9,9);
 const scanner=new Scanner(),rows=[];
 try{
  for(const cell of [1,12,23])for(const factor of [1,.65,.5,.4,.3,.25]){
   ctx.putImageData(clean,0,0);const x=Math.round(60+(cell%9)*600/9)+8,y=Math.round(200+Math.floor(cell/9)*600/9)+8,w=50;
   const tiny=document.createElement('canvas');tiny.width=tiny.height=Math.max(1,Math.round(w*factor));tiny.getContext('2d').drawImage(canvas,x,y,w,w,0,0,tiny.width,tiny.height);ctx.drawImage(tiny,0,0,tiny.width,tiny.height,x,y,w,w);
   const pixels=ctx.getImageData(0,0,720,960),anchor=gridAnchor(pixels,corners,9,9),quality=gridQuality(pixels,corners,9,9),found=await scanner.read(canvas,corners,'sudoku',9,9);
   rows.push({cell,factor,actual:found.puzzle.cells[cell],expected:cells[cell],uncertain:found.uncertain,marked:found.markedCells.includes(cell),mutual:!!matchGrid(anchor,clean)&&!!matchGrid(sharpAnchor,pixels),quality:quality.cells.find(c=>c.cell===cell),sharp:sharpQuality.cells.find(c=>c.cell===cell),wrong:cells.flatMap((v,i)=>v===found.puzzle.cells[i]?[]:[{cell:i,wanted:v,actual:found.puzzle.cells[i]}])});
  }
  return rows;
 }finally{scanner.cancel();}
}
async function run(){const server=await serve();try{await engines('live-refinement-probe.json',async(page,report)=>{await page.goto(server.base);await page.waitForSelector('body[data-ready="true"]');report.cases=await page.evaluate(probe);console.log(JSON.stringify(report));},{timeout:120000});}finally{await server.close();}}
main(module,run);
