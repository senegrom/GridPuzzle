import { checkShape, maxValue } from './model.js';

const supported = p => p && !['auto', 'kakuro', 'kenken', 'killersudoku'].includes(p.type);
const bytesEqual = (a, b) => a?.length === b?.length && a.every((v, i) => v === b[i]);

// A numeric OCR proposal is shown beside the existing draft, never committed
// into the puzzle. Only the editor's ordinary Save path confirms the clue.
export function setupClueReread({ $, getSelection, makeReader, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const panel = $('reread-clue-panel'), button = $('reread-clue'), use = $('use-reread'), message = $('reread-status');
  let reader = null, generation = 0, current = null, proposal = null, deadline = null;
  const cache = new WeakMap(); // An old photo cannot be kept alive by cached proposals.
  const draft = () => JSON.stringify([$('cell-value').value, $('blocked-cell').checked,
    $('across-value').value, $('down-value').value]);
  function selection() {
    const s = getSelection();
    if (!s || s.play || !supported(s.puzzle) || !s.uncertain?.has(s.cell) || !s.image?.width || !s.image?.height ||
        s.source == null || s.source !== s.photoSource || s.rows !== s.puzzle.rows || s.cols !== s.puzzle.cols ||
        !Number.isInteger(s.cell) || s.cell < 0 || s.cell >= s.puzzle.cells.length) return null;
    if (s.puzzle.cells[s.cell] === '#' && s.puzzle.type !== 'str8ts') return null;
    return s;
  }
  const signature = s => JSON.stringify([s.cell, s.source, s.photoSource, s.image.width, s.image.height, s.puzzle]);
  function owns(job) {
    const s = selection();
    return job.id === generation && current === job && s?.image === job.image && signature(s) === job.signature &&
      $('cell-dialog').open && draft() === job.draft;
  }
  function clearDeadline() { clearTimer(deadline); deadline = null; }
  function cancel() {
    generation++; current = proposal = null; clearDeadline(); reader?.cancel();
    button.disabled = false; use.hidden = true;
  }
  function open() {
    cancel(); panel.hidden = !selection();
    message.textContent = panel.hidden ? '' : 'Re-read only this unconfirmed numeric clue. The current field will not change automatically.';
  }
  function present(job, value, cached = false) {
    if (!owns(job)) return;
    proposal = Number.isInteger(value.value) ? { job, value: value.value } : null;
    use.hidden = !proposal;
    message.textContent = `${cached ? 'Same pixels — cached result. ' : ''}${value.message}`;
  }
  button.onclick = async () => {
    const s = selection();
    if (!s || !panel || panel.hidden || current?.busy) return;
    cancel();
    const job = { id: generation, image: s.image, signature: signature(s), draft: draft(), busy: true };
    current = job; button.disabled = true;
    const fail = () => {
      if (!owns(job)) return;
      cancel(); message.textContent = 'Re-reading timed out. The current clue and draft are unchanged.';
    };
    deadline = setTimer(fail, 90000);
    try {
      checkShape(s.puzzle);
      const cw = s.image.width / s.cols, ch = s.image.height / s.rows;
      const x = Math.floor(s.cell % s.cols * cw), y = Math.floor(Math.floor(s.cell / s.cols) * ch);
      const w = Math.max(1, Math.ceil(cw)), h = Math.max(1, Math.ceil(ch));
      // Exact pixels, no collision-prone confidence cache. Bound cache memory
      // independently of imported photo dimensions; normal rectified cells are 100px.
      const pixels = w * h <= 65536 ? s.image.getContext('2d').getImageData(x, y, w, h).data.slice() : null;
      let entries = cache.get(s.image);
      if (!entries) { entries = []; cache.set(s.image, entries); }
      const previous = pixels && entries.find(e => e.key === job.signature && bytesEqual(e.pixels, pixels));
      if (previous) { present(job, previous.result, true); return; }
      message.textContent = 'Reading just this clue…';
      reader ??= makeReader();
      const p = structuredClone(s.puzzle);
      const result = await reader.readCells(s.image, [
        { x: 0, y: 0 }, { x: s.image.width - 1, y: 0 },
        { x: s.image.width - 1, y: s.image.height - 1 }, { x: 0, y: s.image.height - 1 },
      ], { puzzle: p }, [s.cell], text => { if (owns(job)) message.textContent = text; });
      if (!owns(job)) return;
      const e = result.entries?.find(entry => entry.cell === s.cell && ['value', 'blackvalue'].includes(entry.kind));
      const v = result.puzzle?.cells[s.cell];
      const compatible = result.puzzle?.type === p.type && result.puzzle.rows === p.rows && result.puzzle.cols === p.cols &&
        result.targetCells?.length === 1 && result.targetCells[0] === s.cell;
      const black = p.type === 'str8ts' ? [...(p.black ?? [])].sort((a,b) => a-b) : p.cells.flatMap((v,i) => v === '#' ? [i] : []);
      const layout = !['str8ts','hidato'].includes(p.type) || JSON.stringify(result.blackLayout) === JSON.stringify(black);
      const numeric = compatible && layout && e && /^\d{1,3}$/.test(e.text) && Number(e.text) === v &&
        Number.isInteger(v) && v >= (p.type === 'slitherlink' ? 0 : 1) && v <= maxValue(p);
      const value = numeric ? { value: v, message: `OCR proposes ${v}${e.confidence < 85 ? ' (readers disagreed or evidence was uncertain)' : ''}. Compare with the crop. Use proposal only copies it into the field; Save confirms it.` }
        : { value: null, message: layout && compatible ? 'No reliable numeric proposal. The printed mark could not be read; edit the field manually or adjust the scan.' : 'This re-read does not match the original grid. Adjust and re-read the full scan.' };
      if (pixels) { entries.push({ key: job.signature, pixels, result: value }); if (entries.length > 8) entries.shift(); }
      present(job, value);
    } catch (error) {
      if (owns(job)) message.textContent = error?.name === 'AbortError' ? 'Re-read cancelled. Your clue is unchanged.' : 'Could not re-read this clue. Your clue and draft are unchanged; try adjusting the scan.';
    } finally {
      if (job.id === generation) { job.busy = false; clearDeadline(); button.disabled = false; }
    }
  };
  use.onclick = () => {
    if (!proposal || !owns(proposal.job)) { cancel(); return; }
    const value = proposal.value;
    cancel(); $('cell-value').value = String(value);
    message.textContent = 'Proposal copied into the field. Check the crop, then Save to confirm only this clue.';
    $('cell-value').focus?.();
  };
  for (const id of ['cell-value', 'blocked-cell', 'across-value', 'down-value']) {
    $(id).addEventListener('input', () => { cancel(); message.textContent = 'Draft edited. Re-read proposals will not overwrite it.'; });
    $(id).addEventListener('change', cancel);
  }
  $('cell-dialog').addEventListener('close', () => {
    // Native close events are queued. A reopened editor already cancelled the
    // old work in open(); its current draft must not be retired by that event.
    if (!$('cell-dialog').open) { cancel(); panel.hidden = true; }
  });
  $('cell-dialog').addEventListener('cancel', cancel);
  return { open, cancel };
}
