import { STAGE_LABELS, REASON_LABELS } from './scan-diagnostics.js';

// Export is always a separate click after a frozen preview. Images are encoded
// only after explicit opt-in and are re-rendered to omit original EXIF metadata.
export function diagnosticImage(source, doc = document) {
  if (!source?.width || !source?.height) return null;
  const canvas = doc.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
  try {
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', .85);
    if (!dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length > 3000000) throw Error('The diagnostic image is too large. Export without it.');
    return { width: canvas.width, height: canvas.height, mime: 'image/jpeg', dataUrl };
  } finally { canvas.width = canvas.height = 0; }
}
export function setupDiagnosticsUI({ $, diagnostics, getSource }) {
  const panels = ['scan-diagnostics', 'live-diagnostics'].map($).filter(panel => panel?.querySelector);
  for (const panel of panels) {
    const node = key => panel.querySelector(`[data-diagnostic="${key}"]`);
    const summary = node('summary'), reason = node('reason'), preview = node('preview'), include = node('image-toggle'),
      image = node('image'), download = node('download'), error = node('error');
    let frozen = null;
    function update() {
      const snapshot = diagnostics.snapshot();
      // A new scan or closing the camera retires any prepared attachment too.
      // Reopening never carries an earlier image opt-in into another session.
      if (!snapshot.events.length || snapshot.reason === 'stopped') clear();
      summary.textContent = STAGE_LABELS[snapshot.stage];
      reason.textContent = REASON_LABELS[snapshot.reason] ?? 'The report below records stage timings, settings, geometry and review flags. No image is included by default.';
    }
    function clear() {
      frozen = null; preview.hidden = true; preview.textContent = ''; download.disabled = true;
      include.checked = false; image.hidden = true; image.removeAttribute('src'); error.textContent = '';
    }
    function freeze() {
      error.textContent = '';
      try {
        const source = getSource();
        frozen = diagnostics.snapshot();
        frozen.imageDescription = 'Optional current source preview, resized to at most 1600 pixels; not the original file.';
        frozen.readingVerifiedForImage = !!source.verified;
        const attachment = include.checked ? diagnosticImage(source.image) : null;
        if (include.checked && !attachment) throw Error('No current source picture is available. Export without an image or open a new scan.');
        if (attachment) { frozen.image = attachment; frozen.privacy.includesImage = true; image.src = attachment.dataUrl; }
        else image.removeAttribute('src');
        image.hidden = !attachment;
        const display = { ...frozen, ...(attachment ? {image: {...attachment, dataUrl: '[The image shown below is included in the download]'}} : {}) };
        preview.textContent = JSON.stringify(display, null, 2); preview.hidden = false; download.disabled = false;
      } catch (e) { frozen = null; download.disabled = true; image.removeAttribute('src'); image.hidden = true; error.textContent = e.message; }
    }
    node('prepare').onclick = () => { include.checked = false; freeze(); };
    include.onchange = freeze;
    node('clear').onclick = clear;
    download.onclick = () => {
      if (!frozen) return;
      const blob = new Blob([JSON.stringify(frozen, null, 2)], {type:'application/json'}), url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'gridpuzzle-diagnostic.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    };
    panel.addEventListener('toggle', () => { if (!panel.open) clear(); else update(); });
    diagnostics.subscribe(update); update();
    window.addEventListener('pagehide', clear);
  }
  // Editor solver status is already announced through this live region. Only
  // known status patterns become codes: free-form text and stack traces are
  // never copied into the exported diagnostic data.
  if (typeof MutationObserver !== 'undefined' && $('status-text')?.nodeType) {
    const observer = new MutationObserver(() => {
      const text = $('status-text').textContent;
      if (/^(Starting the on-device solver|Solving|Checking your answers)/.test(text)) diagnostics.event({stage:'solving',reason:'started'});
      else if (text.startsWith('Solved ·')) diagnostics.event({stage:'complete',reason:'unique'});
      else if (text.startsWith('No solution to these clues')) diagnostics.event({stage:'checking',reason:'no-solution'});
      else if (text.startsWith('More than one solution')) diagnostics.event({stage:'checking',reason:'multiple'});
      else if (/^(Search limit reached|The solver could not finish)/.test(text)) diagnostics.event({stage:'solving',reason:'unfinished'});
    });
    observer.observe($('status-text'), {childList:true,characterData:true,subtree:true});
  }
}
