import { clone, conflicts, checkShape } from './model.js';

const MAX_RETRY_CELLS = 12;
// Structural targets/signs are not ordinary numeric cell values. Their review
// flags must never be cleared by this numeric-only recovery path.
export function recoveryCells(found, confirmed = []) {
  const p = found?.puzzle;
  if (!p || ['kakuro', 'kenken', 'killersudoku'].includes(p.type)) return [];
  const protectedCells = new Set([...confirmed, ...(found.confirmedCells ?? [])]);
  const marked = new Set(found.markedCells ?? []);
  return [...new Set(found.cellUncertain ?? found.uncertain ?? [])].filter(cell =>
    Number.isInteger(cell) && cell >= 0 && cell < p.cells.length && marked.has(cell) &&
    !protectedCells.has(cell) && (p.cells[cell] !== '#' || p.type === 'str8ts')).sort((a, b) => a - b);
}
export function validateRetryCells(cells, rows, cols) {
  if (!Array.isArray(cells) || !cells.length || cells.length > MAX_RETRY_CELLS ||
      new Set(cells).size !== cells.length || cells.some(cell => !Number.isInteger(cell) || cell < 0 || cell >= rows * cols))
    throw Error('Select between 1 and 12 distinct numeric cells to re-read.');
  return [...cells].sort((a, b) => a - b);
}
export function clearerCells(found, prior, quality, attempted = new Map()) {
  const previous = new Map(prior?.cells?.map(cell => [cell.cell, cell]) ?? []);
  const current = new Map(quality?.cells?.map(cell => [cell.cell, cell]) ?? []);
  return recoveryCells(found).filter(cell => {
    if ((attempted.get(cell) ?? 0) >= 2) return false;
    const a = previous.get(cell), b = current.get(cell);
    if (!b || !Number.isFinite(b.score) || !Number.isFinite(b.contrast) || b.contrast < 35) return false;
    if (!a) return b.score >= 20;
    return b.contrast >= a.contrast * .9 &&
      (b.score >= Math.max(a.score * 1.25, a.score + 8) ||
       (quality.cellPixels >= prior.cellPixels * 1.25 && b.score >= a.score * .95));
  }).slice(0, MAX_RETRY_CELLS);
}

export function mergeRecoveredClues(base, retry, requested, confirmed = []) {
  const p = base.puzzle;
  checkShape(p);
  const selected = validateRetryCells(requested, p.rows, p.cols);
  if (retry.puzzle?.type !== p.type || retry.puzzle.rows !== p.rows || retry.puzzle.cols !== p.cols ||
      JSON.stringify(retry.targetCells) !== JSON.stringify(selected)) throw Error('The clue retry belongs to a different scan.');
  if (['hidato', 'str8ts'].includes(p.type)) {
    const black = p.type === 'str8ts' ? [...(p.black ?? [])].sort((a,b) => a-b) : p.cells.flatMap((v,i) => v === '#' ? [i] : []);
    if (JSON.stringify(black) !== JSON.stringify(retry.blackLayout)) throw Error('Black-cell layout changed. Read the whole puzzle again.');
  }
  const eligible = new Set(recoveryCells(base, confirmed)), previous = new Map((base.entries ?? []).filter(e => ["value", "blackvalue"].includes(e.kind)).map(e => [e.cell, e]));
  const puzzle = clone(p), replacements = new Map(), changed = [], repeated = [];
  for (const entry of retry.entries ?? []) {
    const cell = entry.cell;
    if (!selected.includes(cell) || !eligible.has(cell) || !['value','blackvalue'].includes(entry.kind)) continue;
    const before = previous.get(cell), value = retry.puzzle.cells[cell];
    // Repeated pixels cannot supply independent evidence, and an absent mark
    // can never erase an earlier printed clue or become a solver-filled cell.
    if (entry.evidence && entry.evidence === before?.evidence) { repeated.push(cell); continue; }
    if (!Number.isInteger(value) || !/^\d{1,3}$/.test(entry.text) || Number(entry.text) !== value) continue;
    if (puzzle.cells[cell] !== value) changed.push(cell);
    puzzle.cells[cell] = value;
    replacements.set(cell, { ...entry, confidence: 0, targetedRead: true });
  }
  checkShape(puzzle);
  const cellUncertain = [...new Set([...(base.cellUncertain ?? base.uncertain ?? []), ...conflicts(puzzle)])];
  // Never promote a repeated-frame vote or a correction to confirmed input.
  const found = { ...base, puzzle, needsReview: true, cellUncertain,
    // Both sources were verified against the original grid before merging.
    // Review the sharper source that actually supplied the new proposals.
    rectified: replacements.size ? retry.rectified ?? base.rectified : base.rectified,
    uncertain: [...new Set([...cellUncertain, ...(base.cageUncertain ?? [])])],
    entries: (base.entries ?? []).map(e => replacements.get(e.cell) ?? e),
    recovery: { requested: selected, changed, repeated, proposals: replacements.size },
  };
  for (const [cell, entry] of replacements)
    if (!found.entries.some(e => e.cell === cell)) found.entries.push(entry);
  return found;
}

// Fingerprint exact encoded crops, never OCR strings or expected answers.
export function evidenceKey(samples) {
  let value = 2166136261;
  for (const sample of samples) for (let i = 0; i < sample.length; i++)
    value = Math.imul(value ^ sample.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16).padStart(8, '0') + ':' + samples.map(s => s.length).join(':');
}
