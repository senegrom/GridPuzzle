/* Real canvas-backed MediaStream, production camera/OCR/solver and IndexedDB.
   No physical camera is required. Additional failure cases control OCR replies. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const BASE = "http://127.0.0.1:8778/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reports = [];

async function fixture(page) {
  await page.evaluate(() => {
    const paper = document.createElement("canvas"); paper.width = paper.height = 700;
    window.livePaper = paper;
    window.liveMode = "grid";
    const ctx = paper.getContext("2d");
    const cells = [1,2,3,4,3,null,1,2,2,1,null,3,4,3,2,1];
    let frames = 0;
    function paint() {
      window.livePaintCount = ++frames;
      ctx.fillStyle = "white"; ctx.fillRect(0,0,700,700);
      if (liveMode !== "grid") return;
      ctx.strokeStyle = "black";
      for (let n=0;n<=4;n++) {
        ctx.lineWidth = n%2 ? 3 : 7;
        ctx.beginPath();ctx.moveTo(50+n*150,50);ctx.lineTo(50+n*150,650);
        ctx.moveTo(50,50+n*150);ctx.lineTo(650,50+n*150);ctx.stroke();
      }
      ctx.fillStyle="black";ctx.font="58px Arial";ctx.textAlign="center";ctx.textBaseline="middle";
      cells.forEach((n,i)=>{if(n!==null)ctx.fillText(String(n),50+(i%4+.5)*150,50+(Math.floor(i/4)+.5)*150);});
    }
    paint();
    // Request actual captured frames even when the test paper is static. This
    // exercises video delivery, not merely a live track with no image samples.
    window.livePaintTimer = setInterval(() => {
      paint();
      window.liveTestStream?.getVideoTracks().forEach(track => track.requestFrame?.());
    }, 80);
    const devices = navigator.mediaDevices;
    window.liveGetUserMediaCalls = 0;
    Object.defineProperty(devices, "getUserMedia", {configurable:true, value: async () => {
      window.liveGetUserMediaCalls++;
      const stream = paper.captureStream(12); window.liveTestStream=stream; return stream;
    }});
    // Retain the overridden native wrapper across WebKit garbage collection.
    // The MediaStream, video playback, OCR and solver are still real.
    Object.defineProperty(navigator, "mediaDevices", {configurable:true, value:devices});
    document.getElementById("puzzle-type").value="auto";
    document.getElementById("auto-capture").checked=true;
  });
}
async function idlePage(page) {
  await page.goto(BASE);await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async()=>{window.liveApp=await import("./app.js");});
}
async function startLive(page) {
  await page.click("#camera");
  await page.waitForFunction(() => {
    const start = document.getElementById("start-camera"), video = document.getElementById("video");
    return !start.hidden || video.videoWidth > 0 || /could not open/.test(document.getElementById("status-text").textContent);
  });
  if (await page.locator("#start-camera").isVisible()) await page.click("#start-camera");
  assert.equal(await page.locator("#camera-panel").isVisible(), true, await page.textContent("#status-detail"));
}
async function solveLive(page) {
  await startLive(page);
  await page.waitForFunction(()=>Number(document.getElementById("live-preview").dataset.solution)>0,null,{timeout:150000});
}
async function run() {
  const server=spawn("python",["-m","http.server","8778","--bind","127.0.0.1","--directory","_site"],{stdio:"ignore"});
  fs.mkdirSync("browser-artifacts",{recursive:true});
  try {
    let ready=false;for(let i=0;i<70;i++){try{if((await fetch(BASE)).ok){ready=true;break;}}catch{}await sleep(100);}assert.ok(ready);
    for(const [name,engine] of [["chromium",chromium],["webkit",webkit]]) {
      const browser=await engine.launch({headless:true});
      const context=await browser.newContext({serviceWorkers:"block",viewport:{width:430,height:932},isMobile:true,hasTouch:true});
      const page=await context.newPage(),report={browser:name,version:browser.version(),checks:[],errors:[]};reports.push(report);
      page.setDefaultTimeout(20000);page.on("pageerror",e=>report.errors.push(e.message));
      try {
        await idlePage(page);const accepted=await page.evaluate(()=>liveApp.getState());await fixture(page);await solveLive(page);
        assert.equal(await page.locator("#camera-panel").isVisible(),true);
        assert.equal(await page.evaluate(()=>document.getElementById("video").srcObject.getTracks()[0].readyState),"live");
        assert.deepEqual(await page.evaluate(()=>liveApp.getState().puzzle),accepted.puzzle);
        assert.equal(await page.evaluate(()=>liveApp.getState().result),null,"live solving must not accept or reveal the editor puzzle");
        const counts=await page.locator("#live-preview").evaluate(c=>({...c.dataset}));
        assert.equal(Number(counts.recognised)+Number(counts.uncertain),14);assert.equal(Number(counts.solution),2);assert.equal(Number(counts.unknown),0);
        assert.match(await page.textContent("#camera-help"),/preview/i);
        const panel=await page.locator("#camera-panel").boundingBox();assert.ok(panel.height<=934&&panel.width<=432);
        report.checks.push("real streamed 4x4 Sudoku is detected, recognised and solved over the live view without accepting the editor state");
        await page.screenshot({path:`browser-artifacts/${name}-live-camera.png`});
        // The visible composition is frozen, stored and restorable, not redrawn
        // using a later video frame or by OCR of the already-painted numbers.
        const shown=await page.locator("#live-preview").evaluate(c=>c.toDataURL());await page.click("#take-photo");
        await page.waitForFunction(()=>/Picture saved in this browser/.test(document.getElementById("camera-help").textContent));
        assert.equal(await page.evaluate(()=>liveTestStream.getTracks().every(t=>t.readyState==="ended")),true);
        assert.equal(await page.locator("#live-preview").evaluate(c=>c.toDataURL()),shown);
        const stored=await page.evaluate(async()=>{
          const record=await (await import("./capture-store.js")).loadCapture();
          return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(record.blob);});
        });assert.equal(stored,shown);
        assert.equal(await page.locator("#camera-panel").isVisible(),true,"saving stays on this screen");
        await page.click("#use-live-capture");
        assert.equal((await page.evaluate(()=>liveApp.getState())).needsReview,true);assert.equal((await page.evaluate(()=>liveApp.getState())).result,null);
        await page.click("#solve");assert.equal(await page.locator("#confirm-dialog").isVisible(),true);await page.click("#confirm-back");
        report.checks.push("shutter preserves exact visible pixels in IndexedDB; importing its raw readings still requires review");
        await page.reload();await page.waitForSelector('body[data-ready="true"]');
        await page.waitForSelector("#saved-capture-image");assert.equal(await page.locator("#saved-capture").isVisible(),true);
        await page.click("#delete-capture");await page.waitForFunction(()=>document.getElementById("saved-capture").hidden);
        await page.reload();await page.waitForSelector('body[data-ready="true"]');
        assert.equal(await page.evaluate(async()=>(await (await import("./capture-store.js")).loadCapture())??null),null);
        report.checks.push("saved PNG survives reload; explicit deletion persists");
        await page.evaluate(async()=>{window.liveApp=await import("./app.js");});await fixture(page);await solveLive(page);
        await page.evaluate(()=>{window.liveMode="blank";});
        await page.waitForFunction(()=>Number(document.getElementById("live-preview").dataset.solution)===0,null,{timeout:10000});
        await page.click("#close-camera");assert.equal(await page.evaluate(()=>liveTestStream.getTracks().every(t=>t.readyState==="ended")),true);
        report.checks.push("moving away removes blue entries and closing the camera stops the stream");
        // Controlled unread evidence must remain red and block blue guesses.
        await page.evaluate(async()=>{
          window.liveMode="grid";
          const { Scanner }=await import("./scanner.js"),{makePuzzle}=await import("./model.js");
          Scanner.prototype.read=async()=>{const puzzle=makePuzzle("sudoku",4);puzzle.cells=[1,2,3,4,3,null,1,2,2,1,null,3,4,3,2,1];
            return {puzzle,cellUncertain:[0,5],cageUncertain:[],markedCells:[0,5],needsReview:true,notes:[],rectified:livePaper};};
        });
        await startLive(page);await page.waitForFunction(()=>Number(document.getElementById("live-preview").dataset.uncertain)>0);
        const unclear=await page.locator("#live-preview").evaluate(c=>({...c.dataset}));
        assert.ok(Number(unclear.recognised)>0&&Number(unclear.uncertain)>0&&Number(unclear.unknown)>0);
        assert.equal(Number(unclear.solution),0);await page.click("#close-camera");
        report.checks.push("green/yellow/red readings remain distinct and an unread printed clue is never replaced by a blue guess");
        assert.deepEqual(report.errors,[]);report.ok=true;console.log(`${name}: live camera and capture regressions passed`);
      } catch(error){report.ok=false;report.failure=error.stack;
        report.storageStatus=await page.textContent("#capture-storage-status").catch(()=>"");
        report.paintCount=await page.evaluate(()=>window.livePaintCount).catch(()=>null);
        report.visibility=await page.evaluate(()=>document.visibilityState).catch(()=>null);
        report.cameraCalls=await page.evaluate(()=>window.liveGetUserMediaCalls).catch(()=>null);
        report.video=await page.locator("#video").evaluate(v=>({muted:v.muted,paused:v.paused,width:v.videoWidth,ready:v.readyState,inline:v.playsInline,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,ready:t.readyState}))})).catch(()=>null);
        report.status=await page.textContent("#status-detail").catch(()=>"");
        report.cameraHelp=await page.textContent("#camera-help").catch(()=>"");
        await page.screenshot({path:`browser-artifacts/${name}-live-failure.png`,fullPage:true}).catch(()=>{});throw error;
      } finally{await browser.close();}
    }
  } finally{fs.writeFileSync("browser-artifacts/live-camera.json",JSON.stringify(reports,null,2)+"\n");server.kill();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
