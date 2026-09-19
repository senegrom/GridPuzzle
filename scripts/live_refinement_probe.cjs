const {serve,engines,main}=require('./harness.cjs');
async function probe(){
 const {Scanner}=await import('./scanner.js'),{gridAnchor,matchGrid}=await import('./live-registration.js'),{gridQuality}=await import('./scan-quality.js');
 const canvas=document.createElement('canvas');canvas.width=720;canvas.height=900;const ctx=canvas.getContext('2d'),scanner=new Scanner(),results=[];
 try{
  for(const font of ['Arial','Times New Roman','Courier New']){
   const cells=Array(81).fill(null);for(let k=0;k<27;k++){const i=(k*37+13)%81,r=Math.floor(i/9),c=i%9;cells[i]=(r*3+Math.floor(r/3)+c)%9+1;}
   const corners=[{x:60,y:180},{x:660,y:180},{x:660,y:780},{x:60,y:780}];
   ctx.fillStyle='#edf1f5';ctx.fillRect(0,0,720,900);for(let k=0;k<=9;k++){ctx.strokeStyle=k%3?'#a5aab3':'#343c43';ctx.lineWidth=k%3?1:3;ctx.beginPath();ctx.moveTo(60+k*600/9,180);ctx.lineTo(60+k*600/9,780);ctx.moveTo(60,180+k*600/9);ctx.lineTo(660,180+k*600/9);ctx.stroke();}
   ctx.fillStyle='#24282c';ctx.font=`27px ${font}`;ctx.textAlign='center';ctx.textBaseline='middle';cells.forEach((v,i)=>{if(v!==null)ctx.fillText(String(v),60+(i%9+.5)*600/9,180+(Math.floor(i/9)+.5)*600/9);});
   const clean=ctx.getImageData(0,0,720,900),a=gridAnchor(clean,corners,9,9),cq=gridQuality(clean,corners,9,9),baseline=await scanner.read(canvas,corners,'sudoku',9,9);
   for(const cell of [31,38,52])for(const factor of [.65,.5,.4]){
    ctx.putImageData(clean,0,0);const x=Math.round(60+cell%9*600/9)+8,y=Math.round(180+Math.floor(cell/9)*600/9)+8,w=50;
    const tiny=document.createElement('canvas');tiny.width=tiny.height=Math.round(w*factor);tiny.getContext('2d').drawImage(canvas,x,y,w,w,0,0,tiny.width,tiny.height);ctx.drawImage(tiny,0,0,tiny.width,tiny.height,x,y,w,w);
    const pixels=ctx.getImageData(0,0,720,900),q=gridQuality(pixels,corners,9,9),b=gridAnchor(pixels,corners,9,9),f=await scanner.read(canvas,corners,'sudoku',9,9);
    results.push({font,cell,factor,mutual:!!matchGrid(a,pixels)&&!!matchGrid(b,clean),uncertain:f.uncertain,actual:f.puzzle.cells[cell],expected:cells[cell],clear:baseline.puzzle.cells[cell],quality:q.cells.find(c=>c.cell===cell),sharp:cq.cells.find(c=>c.cell===cell)});
   }
  }return results;
 }finally{scanner.cancel();}
}
async function run(){const server=await serve();try{await engines('live-refinement-probe.json',async(page,report)=>{await page.goto(server.base);await page.waitForSelector('body[data-ready="true"]');report.cases=await page.evaluate(probe);console.log(JSON.stringify(report));},{timeout:180000});}finally{await server.close();}}
main(module,run);
