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
// Every drawImage onto #live-preview, with the canvas's data-view at the time:
// while live the video is the display and the canvas holds only an outline,
// so a camera frame reaches it once, at the freeze, or from the shutter.
async function recordPreviewDraws(page) {
  await page.evaluate(()=>{
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    window.previewDraws=[];
    CanvasRenderingContext2D.prototype.drawImage=function(...args){
      if(this.canvas?.id==="live-preview")previewDraws.push({view:this.canvas.dataset.view,source:args[0]?.constructor?.name});
      return draw.apply(this,args);
    };
  });
}
// The live capture keeps its reading on a verified frame at most half a
// second old. Press the shutter just after a verification reply has been
// adopted, so that the frame is fresh whatever the engine's tick spacing.
async function shutterAfterVerification(page) {
  await page.evaluate(()=>new Promise(resolve=>{
    window.onTrackReply=()=>{window.onTrackReply=null;setTimeout(()=>{document.getElementById("take-photo").click();resolve();},0);};
  }));
}
async function watchTrackReplies(page) {
  await page.evaluate(()=>{
    const Native=window.Worker;
    window.Worker=class extends Native{constructor(url,options){super(url,options);
      if(/live-tracking-worker/.test(String(url)))this.addEventListener("message",({data})=>{if(data?.result?.proofs)window.onTrackReply?.();});}};
  });
}
// The solved view is frozen until Clear: a still of the verified frame with
// its solution, the video paused behind it (visible, covered) and still attached to
// its stream (`attached`),
// the camera still on (`tracks`: the latest stream getUserMedia gave out).
async function frozenState(page) {
  return page.evaluate(()=>{
    const preview=document.getElementById("live-preview"), video=document.getElementById("video"), visible=id=>{
      const node=document.getElementById(id);return !node.hidden&&node.getClientRects().length>0;};
    // WCAG contrast of the chip's computed text and background colours.
    const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number), luminance=([r,g,b])=>{
      const linear=c=>(c/=255)<=.04045?c/12.92:((c+.055)/1.055)**2.4;return .2126*linear(r)+.7152*linear(g)+.0722*linear(b);};
    const chipStyle=getComputedStyle(document.getElementById("view-state"));
    const [light,dark]=[luminance(rgb(chipStyle.color)),luminance(rgb(chipStyle.backgroundColor))].sort((a,b)=>b-a);
    return {view:preview.dataset.view, panel:document.getElementById("camera-panel").dataset.view,
      clear:visible("clear-freeze"), chip:visible("view-state"), restart:visible("restart-live"),
      chipContrast:Math.round((light+.05)/(dark+.05)*100)/100,
      paused:video.paused, visibility:getComputedStyle(video).visibility, attached:!!video.srcObject,
      tracks:window.liveTestStream?.getTracks().map(t=>({enabled:t.enabled,ready:t.readyState}))??null,
      help:document.getElementById("camera-help").textContent, solution:Number(preview.dataset.solution)};
  });
}
// The page as an app switch leaves it: document.hidden and a visibilitychange.
async function hidePage(page) {
  await page.evaluate(()=>{
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
}
// Viewfinder and action-row geometry, with the help line pinned to one text
// for the measurement so that only the action row can change the viewfinder.
async function cameraLayout(page) {
  return page.evaluate(()=>{
    const help=document.getElementById("camera-help"), text=help.textContent;
    help.textContent="Hold the grid steady.";
    const box=selector=>document.querySelector(selector).getBoundingClientRect(), row=document.querySelector(".camera-actions");
    const result={viewfinder:box("#camera-panel .viewfinder").height,row:box(".camera-actions").height,
      rowOverflow:row.scrollWidth>row.clientWidth,shutter:box("#take-photo"),clear:box("#clear-freeze"),start:box("#start-camera"),panel:box("#camera-panel")};
    help.textContent=text;
    return JSON.parse(JSON.stringify(result));
  });
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
        await idlePage(page,server.base);const accepted=await page.evaluate(()=>liveApp.getState());await fixture(page);
        await recordPreviewDraws(page);await solveLive(page);
        // The video was the display while aiming and reading: the one camera
        // frame on the canvas is the frozen one, drawn by the render that froze.
        const draws=await page.evaluate(()=>previewDraws);report.previewDraws=draws;
        assert.deepEqual(draws,[{view:"live",source:"HTMLCanvasElement"}],"no camera-frame paint before the freeze, exactly one at it");
        assert.equal(await page.locator("#live-preview").getAttribute("data-overlay"),"composition");
        assert.equal(await page.locator("#camera-panel").isVisible(),true);
        assert.equal(await page.evaluate(()=>liveTestStream.getTracks()[0].readyState),"live");
        assert.deepEqual(await page.evaluate(()=>liveApp.getState().puzzle),accepted.puzzle);
        assert.equal(await page.evaluate(()=>liveApp.getState().result),null,"live solving must not accept or reveal the editor puzzle");
        const counts=await page.locator("#live-preview").evaluate(c=>({...c.dataset}));
        assert.equal(Number(counts.recognised)+Number(counts.uncertain),14);assert.equal(Number(counts.solution),2);assert.equal(Number(counts.unknown),0);
        assert.match(await page.textContent("#camera-help"),/preview/i);
        const panel=await page.locator("#camera-panel").boundingBox();assert.ok(panel.height<=934&&panel.width<=432);
        report.checks.push("real streamed 4x4 Sudoku is detected, recognised and solved over the live view without accepting the editor state");
        const frozen=await frozenState(page);report.frozen=frozen;
        assert.equal(frozen.view,"frozen");assert.equal(frozen.panel,"frozen");
        assert.equal(frozen.clear,true,"Clear is offered");assert.equal(frozen.chip,true,"the Frozen chip is shown");assert.equal(frozen.restart,false);
        assert.ok(frozen.chipContrast>=4.5,`the chip's text has AA contrast (${frozen.chipContrast}:1)`);
        assert.equal(frozen.paused,true);assert.equal(frozen.visibility,"visible","the paused video stays visible behind the opaque still: WebKit gives a new player on an invisible video no frame");
        assert.equal(frozen.attached,true,"and still attached to its stream, ready to play again");
        assert.deepEqual(frozen.tracks,[{enabled:true,ready:"live"}],"the camera stays on while frozen");
        assert.match(frozen.help,/frozen/);
        const still=await page.locator("#live-preview").evaluate(c=>c.toDataURL());
        await sleep(1000);
        assert.equal(await page.locator("#live-preview").evaluate(c=>c.toDataURL()),still,"the frozen picture does not change");
        report.checks.push("the solved view freezes until Clear: video paused behind the still and still attached, camera track kept on and enabled");
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
        assert.equal(await page.evaluate(()=>previewDraws.length),1,"a frozen capture paints nothing: the canvas is the stored picture");
        assert.equal(await page.locator("#camera-panel").getAttribute("data-view"),"captured");
        assert.equal(await page.locator("#clear-freeze").isVisible(),false);
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
        await time("moving away, Clear and closing",async()=>{
        await page.evaluate(async()=>{window.liveApp=await import("./app.js");});await fixture(page);await solveLive(page);
        const calls=await page.evaluate(()=>liveGetUserMediaCalls);
        await page.evaluate(()=>{window.liveMode="blank";});
        await sleep(1500);
        assert.ok(Number(await page.locator("#live-preview").getAttribute("data-solution"))>0,"moving away keeps the frozen solution");
        await page.click("#clear-freeze");
        await page.waitForFunction(()=>document.getElementById("live-preview").dataset.view==="live");
        await page.waitForFunction(()=>Number(document.getElementById("live-preview").dataset.solution)===0);
        const live=await frozenState(page);
        assert.equal(live.panel,"live");assert.equal(live.clear,false);assert.equal(live.chip,false);
        assert.equal(live.paused,false);assert.equal(live.visibility,"visible");
        assert.equal(live.attached,true,"Clear plays the stream that stayed attached");
        assert.deepEqual(live.tracks,[{enabled:true,ready:"live"}]);
        assert.equal(await page.evaluate(()=>liveGetUserMediaCalls),calls,"Clear plays the camera that stayed on");
        assert.equal(await page.evaluate(()=>document.activeElement.id),"take-photo");
        await sleep(1500);
        assert.equal(Number(await page.locator("#live-preview").getAttribute("data-solution")),0,"the old solution does not return");
        await page.click("#close-camera");assert.equal(await page.evaluate(()=>liveTestStream.getTracks().every(t=>t.readyState==="ended")),true);
        report.checks.push("moving away keeps the frozen solution; Clear returns to the live camera without a new permission request; closing stops the stream");
        });
        await time("frozen, camera off",async()=>{
        await page.evaluate(()=>{window.liveMode="grid";});await solveLive(page);
        const shown=await page.locator("#live-preview").evaluate(c=>c.toDataURL()), calls=await page.evaluate(()=>liveGetUserMediaCalls);
        await hidePage(page);
        assert.equal(await page.evaluate(()=>liveTestStream.getTracks().every(t=>t.readyState==="ended")),true,"hiding the app turns the camera off");
        const off=await frozenState(page);
        assert.equal(off.view,"frozen");assert.equal(off.clear,true);assert.equal(off.attached,false);
        assert.deepEqual(off.tracks,[{enabled:true,ready:"ended"}]);
        assert.match(off.help,/turned off while the app was in the background/);
        assert.equal(await page.locator("#camera-panel").isVisible(),true);
        assert.equal(await page.locator("#live-preview").evaluate(c=>c.toDataURL()),shown,"the frozen picture stays");
        await page.click("#clear-freeze");
        await page.waitForFunction(()=>document.getElementById("live-preview").dataset.view==="live");
        assert.equal(await page.evaluate(()=>liveGetUserMediaCalls),calls+1,"Clear asks for the camera again");
        assert.deepEqual((await frozenState(page)).tracks,[{enabled:true,ready:"live"}]);
        // The same grid is read and frozen again; Save picture keeps that
        // frozen picture although the camera was turned off meanwhile.
        await page.waitForFunction(()=>document.getElementById("live-preview").dataset.view==="frozen",null,{timeout:150000});
        await hidePage(page);
        const frozen=await page.locator("#live-preview").evaluate(c=>c.toDataURL());
        await page.click("#take-photo");
        await page.waitForFunction(()=>/Picture saved in this browser/.test(document.getElementById("camera-help").textContent));
        const stored=await page.evaluate(async()=>{
          const record=await (await import("./capture-store.js")).loadCapture();
          return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(record.blob);});
        });assert.equal(stored,frozen,"the stored PNG is the frozen picture");
        await page.click("#close-camera");
        report.checks.push("hiding the app while frozen turns the camera off but keeps the solution; Clear asks for the camera again; Save picture keeps a frozen picture without a camera");
        });
        await time("320 px",async()=>{
          const size=page.viewportSize();
          await page.setViewportSize({width:320,height:568});
          try {
            await page.evaluate(()=>{window.liveMode="grid";});await startLive(page);
            // WebKit offers Start preview until its tap starts playback (startLive
            // taps it): measure the live row once the button has gone.
            await page.waitForFunction(()=>document.getElementById("start-camera").hidden&&document.getElementById("video").videoWidth>0);
            const live=await cameraLayout(page);
            await page.waitForFunction(()=>document.getElementById("live-preview").dataset.view==="frozen",null,{timeout:150000});
            const frozen=await cameraLayout(page);report.narrowLayout={live,frozen};
            assert.equal(frozen.viewfinder,live.viewfinder,"freezing does not shrink the viewfinder");
            assert.equal(frozen.row,live.row,"the frozen action row stays one line");assert.equal(frozen.rowOverflow,false);
            assert.equal(frozen.clear.top,frozen.shutter.top);assert.ok(frozen.clear.right<=frozen.panel.right);
            // A Clear whose playback was refused adds Start preview to the row:
            // it takes a line of its own, and Save picture and Clear keep size.
            await page.evaluate(()=>{document.getElementById("start-camera").hidden=false;});
            const retry=await cameraLayout(page);report.narrowLayout.retry=retry;
            await page.evaluate(()=>{document.getElementById("start-camera").hidden=true;});
            assert.equal(retry.rowOverflow,false);
            for (const key of ["shutter","clear"])
              assert.deepEqual([retry[key].width,retry[key].height],[frozen[key].width,frozen[key].height],`${key} is not squeezed beside Start preview`);
            assert.equal(retry.clear.top,retry.shutter.top);assert.ok(retry.start.bottom<=retry.shutter.top,"Start preview has a line of its own");
            await page.click("#close-camera");
          } finally { await page.setViewportSize(size); }
          report.checks.push("on a 320 x 568 screen the frozen row (Save picture, Clear) stays one line and the viewfinder keeps its size; Start preview after a refused Clear gets a line of its own");
        });
        await time("live capture with automatic solving off",async()=>{
          // Nothing freezes without automatic solving: the playing video stays
          // the display, with the outline over it and the counts in the legend,
          // and the shutter keeps a fresh verified frame with its clues, which
          // the panel then shows exactly as stored.
          await watchTrackReplies(page);
          const autoSolve=value=>page.evaluate(value=>{const box=document.getElementById("auto-solve");box.checked=value;box.dispatchEvent(new Event("change",{bubbles:true}));},value);
          await page.evaluate(()=>{window.liveMode="grid";});await autoSolve(false);
          try {
            await startLive(page);
            // The complete reading (the provisional atlas reading shows the
            // same 14 clues earlier, all flagged, while the help line says
            // "Checking printed clues…"). The help line names the complete
            // reading's counts as it completes; the canvas and the legend show
            // them with the next render, up to a heartbeat (100 ms) later.
            await page.waitForFunction(()=>{const d=document.getElementById("live-preview").dataset;
              const help=/^Clues read \((\d+) recognised, (\d+) uncertain\)\. Automatic solving is off/.exec(document.getElementById("camera-help").textContent);
              return !!help&&d.recognised===help[1]&&d.uncertain===help[2]&&Number(d.recognised)+Number(d.uncertain)===14;},null,{timeout:150000});
            const live=await page.evaluate(()=>{const preview=document.getElementById("live-preview");
              return {view:preview.dataset.view,overlay:preview.dataset.overlay,solution:Number(preview.dataset.solution),paused:document.getElementById("video").paused,
                legend:["recognised","uncertain","unknown","solution"].map(key=>document.getElementById(`legend-${key}`).getAttribute("data-count")),
                help:document.getElementById("camera-help").textContent};});
            report.liveCapture={live};
            assert.equal(live.view,"live");assert.equal(live.overlay,"outline");assert.equal(live.solution,0);assert.equal(live.paused,false);
            assert.equal(Number(live.legend[0])+Number(live.legend[1]),14,"the legend counts the reading");assert.equal(live.legend[3],null,"and no solution");
            assert.equal(live.help.match(/^Clues read \(\d+ recognised, \d+ uncertain\)\. Automatic solving is off/)?.[0],
              `Clues read (${live.legend[0]} recognised, ${live.legend[1]} uncertain). Automatic solving is off`,"the legend and the help line give the same counts");
            await shutterAfterVerification(page);
            await page.waitForFunction(()=>/Picture saved in this browser/.test(document.getElementById("camera-help").textContent));
            const shown=await page.locator("#live-preview").evaluate(c=>c.toDataURL());
            const stored=await page.evaluate(async()=>{
              const record=await (await import("./capture-store.js")).loadCapture();
              return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(record.blob);});
            });
            assert.equal(stored,shown,"the panel shows exactly the stored picture");
            assert.equal(await page.locator("#live-preview").getAttribute("data-view"),"captured");
            assert.match(await page.textContent("#use-live-capture"),/Review captured clues/,"a fresh verified frame keeps its reading");
            report.liveCapture.offered=await page.textContent("#use-live-capture");
            await page.click("#close-camera");
          } finally { await autoSolve(true); }
          report.checks.push("without automatic solving the live video stays the display with the outline and legend counts; the shutter stores a fresh verified frame with its reading and shows exactly that picture");
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
