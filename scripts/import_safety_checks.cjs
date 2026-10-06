// Native browser codecs and service-worker lifecycle, without OCR heuristics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serve, PHONE } = require('./harness.cjs');
async function photoImports(page, report, base) {
  await page.goto(base);
  await page.waitForSelector('body[data-ready="true"]');
  const rows = await page.evaluate(async () => {
    const { importPhoto } = await import('./photo-import.js');
    const actual = globalThis.createImageBitmap, rows = [];
    const palette = [[220,30,30],[30,180,30],[30,30,220],[220,200,30]];
    for (const [width,height] of [[1600,400],[400,1600],[3200,800]]) {
      const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
      const ctx=canvas.getContext('2d');
      for(const [i,[x,y]]of [[0,[0,0]],[1,[width/2,0]],[2,[width/2,height/2]],[3,[0,height/2]]]) {
        ctx.fillStyle=`rgb(${palette[i].join(',')})`;ctx.fillRect(x,y,width/2,height/2);
      }
      const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95));
      canvas.width=canvas.height=0;
      for(let orientation=1;orientation<=8;orientation++) {
        // JPEG APP1 + Exif + big-endian primary TIFF IFD. No full-size decoder
        // is used to discover orientation; the fixture comes from canvas JPEG.
        const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,orientation,0,0,0,0,0,0]);
        const file=new Blob([jpeg.slice(0,2),exif,jpeg.slice(2)],{type:'image/jpeg'}),decodes=[];
        globalThis.createImageBitmap=async(...args)=>{const bitmap=await actual(...args);decodes.push([bitmap.width,bitmap.height]);return bitmap;};
        let image;
        try {
          ({image}=await importPhoto(file));
          const pixels=image.getContext('2d'),colors=[];
          for(const [x,y]of [[.25,.25],[.75,.25],[.75,.75],[.25,.75]]) {
            const value=pixels.getImageData(Math.floor(x*image.width),Math.floor(y*image.height),1,1).data;
            const distances=palette.map(rgb=>rgb.reduce((d,v,i)=>d+(v-value[i])**2,0));
            colors.push(distances.indexOf(Math.min(...distances)));
          }
          rows.push({width,height,orientation,decodes,preview:[image.width,image.height],colors});
        } finally {globalThis.createImageBitmap=actual;if(image)image.width=image.height=0;}
      }
    }
    return rows;
  });
  const orientations=[[0,1,2,3],[1,0,3,2],[2,3,0,1],[3,2,1,0],[0,3,2,1],[3,0,1,2],[2,1,0,3],[1,2,3,0]];
  for(const row of rows) {
    const scale=Math.min(1,1600/Math.max(row.width,row.height)),size=[Math.round(row.width*scale),Math.round(row.height*scale)];
    if(row.orientation>=5)size.reverse();
    assert.deepEqual(row.decodes,[size],`bounded native bitmap: ${JSON.stringify(row)}`);
    assert.deepEqual(row.preview,size);assert.deepEqual(row.colors,orientations[row.orientation-1],`rotation/mirroring: ${JSON.stringify(row)}`);
  }
  report.photoImport={nativeJPEG:true,cases:rows};
}
async function offlineInstall(browser, report) {
  // The transaction suites block service workers; this lifecycle check needs
  // a separate, genuinely enabled registration on a fresh origin.
  const context = await browser.newContext({ ...PHONE, serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(error.message));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gridpuzzle-install-'));
  let server;
  try {
    fs.copyFileSync('_site/offline.js',path.join(directory,'offline.js'));
    fs.writeFileSync(path.join(directory,'index.html'),`<!doctype html><html><body>
      <button id="prepare-offline" disabled>Download offline assets</button><p id="offline-state">First use needs an internet connection.</p>
      <button id="update-app" hidden></button><div id="update-banner" hidden><button id="update-banner-button"></button></div>
      <script type="module">import {setupOffline} from './offline.js';setupOffline(id=>document.getElementById(id));</script></body></html>`);
    // Use a real registration and failed installation, not a rejected register
    // promise. A controlled worker isolates UI recovery from the asset gate.
    fs.writeFileSync(path.join(directory,'sw.js'),`self.addEventListener('install',e=>e.waitUntil(Promise.reject(Error('controlled installation failure'))));`);
    server=await serve({directory});await page.goto(server.base);
    await page.waitForFunction(()=>document.getElementById('prepare-offline').textContent.includes('Reload'));
    assert.equal(await page.locator('#prepare-offline').isEnabled(),true);
    assert.match(await page.textContent('#offline-state'),/failed|did not finish/);
    await page.evaluate(()=>localStorage.setItem('gridpuzzle-session-v1','unchanged saved puzzle'));
    fs.writeFileSync(path.join(directory,'sw.js'),`self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
      self.addEventListener('message',e=>e.ports[0]?.postMessage({done:true,ready:e.data.type==='PREPARE_OFFLINE'}));`);
    // Python's static server uses second-resolution Last-Modified. Make the
    // replacement visible even when both writes happen in the same second.
    const changed = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(directory,'sw.js'),changed,changed);
    await Promise.all([page.waitForNavigation(),page.click('#prepare-offline')]);
    await page.waitForFunction(()=>!document.getElementById('prepare-offline').disabled&&document.getElementById('prepare-offline').textContent==='Download offline assets');
    await page.click('#prepare-offline');await page.waitForFunction(()=>document.getElementById('offline-state').textContent.includes('assets are ready'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('gridpuzzle-session-v1')),'unchanged saved puzzle');
    report.offlineInstall={nativeLifecycle:true,controlledWorker:true,explicitRetrySucceeded:true,savedStatePreserved:true};
  } finally {await context.close();await server?.close();fs.rmSync(directory,{recursive:true,force:true});}
}
module.exports={photoImports,offlineInstall};
