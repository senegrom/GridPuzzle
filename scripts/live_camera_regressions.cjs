/* Real canvas-backed MediaStream, production camera/OCR/solver and IndexedDB.
   No physical camera is required. Additional failure cases control OCR replies. */
const assert = require("node:assert/strict");
const { serve, engines, main, sleep } = require("./harness.cjs");

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
async function idlePage(page,base) {
  await page.goto(base);await page.waitForSelector('body[data-ready="true"]');
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
// Wall time per phase and engine, in the report and the log, so that a split
// of this long suite can be decided from measurements. A nested phase is part
// of its parent's time; entries keep the order in which the phases started.
function phaseTimer(report,name) {
  report.phases=[];
  return function time(phase,run) {
    const entry={phase,seconds:null},started=performance.now();
    report.phases.push(entry);
    return Promise.resolve().then(run).finally(()=>{
      entry.seconds=Math.round((performance.now()-started)/100)/10;
      console.log(`${name} ${phase}: ${entry.seconds} s`);
    });
  };
}
async function run() {
  const server=await serve();
  try {
    await engines("live-camera.json",async(page,report,name)=>{
      report.checks=[];
      const time=phaseTimer(report,name);
      try {
        await time("live solve",async()=>{
        await idlePage(page,server.base);const accepted=await page.evaluate(()=>liveApp.getState());await fixture(page);await solveLive(page);
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
        });
        await time("capture and diagnostics",async()=>{
        // The visible composition is frozen, stored and restorable, not redrawn
        // using a later video frame or by OCR of the already-painted numbers.
        await page.evaluate(() => {
          const panel = document.getElementById("live-diagnostics"), node = key => panel.querySelector(`[data-diagnostic="${key}"]`);
          node("prepare").click(); node("image-toggle").checked = true; node("image-toggle").dispatchEvent(new Event("change"));
          if (node("download").disabled) throw Error("Live diagnostic image should be available before capture");
        });
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
        report.captureDiagnostic = await page.evaluate(async () => {
          const panel = document.getElementById("scan-diagnostics"), node = key => panel.querySelector(`[data-diagnostic="${key}"]`);
          for (const id of ["scan-diagnostics", "live-diagnostics"]) {
            const p = document.getElementById(id);
            if (p.querySelector('[data-diagnostic="image-toggle"]').checked ||
                p.querySelector('[data-diagnostic="image"]').hasAttribute("src")) throw Error("Capture handoff retained old image consent");
          }
          node("prepare").click(); const metadata = JSON.parse(node("preview").textContent);
          if (metadata.source !== "photo" || !metadata.readingVerifiedForImage || metadata.privacy.includesImage || metadata.image)
            throw Error("Capture diagnostic provenance or default privacy is wrong");
          node("image-toggle").checked = true; node("image-toggle").dispatchEvent(new Event("change"));
          if (node("download").disabled) throw Error(node("error").textContent);
          const img = new Image(); img.src = node("image").src; await img.decode();
          const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
          const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0); const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
          let coloured = 0; for (let i = 0; i < pixels.length; i += 4)
            if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) - Math.min(pixels[i], pixels[i+1], pixels[i+2]) > 25) coloured++;
          c.width = c.height = 0;
          if (coloured) throw Error("Diagnostic image contains coloured annotations, not the raw capture");
          const result = { source: metadata.source, verified: metadata.readingVerifiedForImage,
            defaultImage: metadata.privacy.includesImage, freshOptIn: JSON.parse(node("preview").textContent).privacy.includesImage,
            annotatedPixels: coloured };
          node("clear").click(); return result;
        });
        report.checks.push("captured-photo diagnostic handoff resets image consent; fresh opt-in exports raw pixels without solution annotations");
        await page.click("#solve");assert.equal(await page.locator("#confirm-dialog").isVisible(),true);await page.click("#confirm-back");
        report.checks.push("shutter preserves exact visible pixels in IndexedDB; importing its raw readings still requires review");
        });
        await time("saved picture reload and deletion",async()=>{
        await page.reload();await page.waitForSelector('body[data-ready="true"]');
        await page.waitForSelector("#saved-capture-image");assert.equal(await page.locator("#saved-capture").isVisible(),true);
        await page.click("#delete-capture");await page.waitForFunction(()=>document.getElementById("saved-capture").hidden);
        await page.reload();await page.waitForSelector('body[data-ready="true"]');
        assert.equal(await page.evaluate(async()=>(await (await import("./capture-store.js")).loadCapture())??null),null);
        report.checks.push("saved PNG survives reload; explicit deletion persists");
        });
        await time("moving away and closing",async()=>{
        await page.evaluate(async()=>{window.liveApp=await import("./app.js");});await fixture(page);await solveLive(page);
        await page.evaluate(()=>{window.liveMode="blank";});
        await page.waitForFunction(()=>Number(document.getElementById("live-preview").dataset.solution)===0,null,{timeout:10000});
        await page.click("#close-camera");assert.equal(await page.evaluate(()=>liveTestStream.getTracks().every(t=>t.readyState==="ended")),true);
        report.checks.push("moving away removes blue entries and closing the camera stops the stream");
        });
        await time("unread evidence",async()=>{
        // Controlled unread evidence must remain red and block blue guesses.
        await page.evaluate(async()=>{
          window.liveMode="grid";
          const { Scanner }=await import("./scanner.js"),{makePuzzle}=await import("./model.js");
          Scanner.prototype.read=async()=>{const puzzle=makePuzzle("sudoku",4);puzzle.cells=[1,2,3,4,3,null,1,2,2,1,null,3,4,3,2,1];
            return {puzzle,cellUncertain:[0,5],cageUncertain:[],markedCells:[0,5],needsReview:true,notes:[],rectified:livePaper};};
        });
        // Read the counts inside the wait: a fallback frame between the wait and
        // a second read would clear them on a loaded machine.
        await startLive(page);
        const unclear=await (await page.waitForFunction(()=>{const d=document.getElementById("live-preview").dataset;
          return Number(d.uncertain)>0 ? {...d} : false;})).jsonValue();
        assert.ok(Number(unclear.recognised)>0&&Number(unclear.uncertain)>0&&Number(unclear.unknown)>0);
        assert.equal(Number(unclear.solution),0);await page.click("#close-camera");
        report.checks.push("green/yellow/red readings remain distinct and an unread printed clue is never replaced by a blue guess");
        });
        await time("capture without a live reading",async()=>{
        // With automatic reading paused there is no live transcription, but the
        // shutter must still lead somewhere: the exact frame enters the crop editor.
        await page.evaluate(()=>{document.getElementById("auto-capture").checked=false;});
        await startLive(page);
        await page.waitForFunction(()=>/Automatic reading is paused/.test(document.getElementById("camera-help").textContent));
        await page.click("#take-photo");
        await page.waitForFunction(()=>!document.getElementById("use-live-capture").hidden);
        assert.match(await page.textContent("#use-live-capture"),/Crop and read/);
        await page.click("#use-live-capture");
        await page.waitForFunction(()=>document.getElementById("status-text").textContent==="Grid found.");
        assert.equal(await page.locator("#camera-panel").isHidden(),true);
        assert.equal(await page.locator("#photo-panel").isVisible(),true);
        assert.equal(await page.locator("#crop-canvas").isVisible(),true);assert.match(await page.textContent("#status-detail"),/Detected 4/);
        await page.evaluate(()=>{document.getElementById("auto-capture").checked=true;});
        report.checks.push("a capture without a live reading opens the crop editor with the detected grid");
        });
        // Keep the real canvas MediaStream and real grid detector. Delay one
        // detector call to exercise settings cancellation and bounded recovery.
        for (const recovery of ["settings", "deadline"]) await time(`detector recovery: ${recovery}`,async()=>{
          await page.evaluate(async () => {
            const { Scanner } = await import("./scanner.js");
            window.originalLiveDetect ??= Scanner.prototype.detect;
            window.recoveryDetectCalls = 0;
            window.delayedDetect = null;
            Scanner.prototype.detect = function (...args) {
              if (++window.recoveryDetectCalls === 1)
                return new Promise((resolve, reject) => { window.delayedDetect = { resolve, reject }; });
              return originalLiveDetect.apply(this, args);
            };
          });
          await startLive(page);
          await page.waitForFunction(() => Boolean(window.delayedDetect));
          if (recovery === "settings")
            await page.evaluate(() => { document.getElementById("puzzle-type").value = "sudoku"; });
          await page.waitForFunction(() => Number(document.getElementById("live-preview").dataset.uncertain) > 0, null, { timeout: 20000 });
          assert.ok(await page.evaluate(() => recoveryDetectCalls >= 2));
          // The recovery UI may legitimately progress from "unread clue" to
          // "waiting for a clearer frame" while this obsolete promise settles.
          // Observe every mutation, including removed/transient text, rather
          // than freezing a status sampled on a different video frame.
          const observed = await page.evaluate(async () => {
            const help = document.getElementById("camera-help"), seen = [help.textContent];
            const collect = records => {
              for (const record of records) {
                if (record.oldValue !== null) seen.push(record.oldValue);
                for (const node of [...record.addedNodes, ...record.removedNodes]) seen.push(node.textContent);
              }
              seen.push(help.textContent);
            };
            const observer = new MutationObserver(collect);
            observer.observe(help, { childList: true, characterData: true, characterDataOldValue: true, subtree: true });
            try {
              delayedDetect.reject(Error("Obsolete detector failure"));
              await new Promise(resolve => setTimeout(resolve, 350));
              collect(observer.takeRecords());
              return [...new Set(seen)].filter(Boolean);
            } finally { observer.disconnect(); }
          });
          assert.ok(observed.length > 0, "camera status remains available after detector recovery");
          assert.ok(observed.every(message => !message.includes("Obsolete detector failure")),
            "a retired detector error must never reach the UI, even transiently");
          (report.detectorRecoveryStatuses ??= []).push({ recovery, observed });
          assert.equal(await page.locator("#camera-panel").isVisible(), true);
          assert.equal(await page.evaluate(() => liveTestStream.getTracks()[0].readyState), "live");
          await page.click("#close-camera");
        });
        report.checks.push("settings changes and detection deadlines recover from a stalled detector without stopping video or accepting its late error");
        report.reviewSafety=await time("review safety",()=>
          require("./review_safety_regressions.cjs")(page,(phase,run)=>time(`review safety / ${phase}`,run)));
        report.checks.push("single-clue changes retire pending and solved overlays; faint clues retain ink evidence; deleted PNGs stay deleted after reload");
        console.log(`${name}: live camera and capture regressions passed`);
      } catch(error){
        report.storageStatus=await page.textContent("#capture-storage-status").catch(()=>"");
        report.paintCount=await page.evaluate(()=>window.livePaintCount).catch(()=>null);
        report.visibility=await page.evaluate(()=>document.visibilityState).catch(()=>null);
        report.cameraCalls=await page.evaluate(()=>window.liveGetUserMediaCalls).catch(()=>null);
        report.video=await page.locator("#video").evaluate(v=>({muted:v.muted,paused:v.paused,width:v.videoWidth,ready:v.readyState,inline:v.playsInline,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,ready:t.readyState}))})).catch(()=>null);
        report.statusDetail=await page.textContent("#status-detail").catch(()=>"");
        report.cameraHelp=await page.textContent("#camera-help").catch(()=>"");
        throw error;
      }
    });
  } finally{server.close();}
}
module.exports = { run };
main(module,run);
