// One bounded contract for composed scan warnings, autosave and backups.
// Text is explanatory: cell/cage flags and black-cell evidence are preserved
// separately. Truncation must never certify a transcription as reviewed.
export const MAX_REVIEW_NOTES = 32;
export const MAX_REVIEW_NOTE_LENGTH = 500;
const OMITTED = 'Additional scan warnings were condensed. Review all printed clues and puzzle rules before solving.';
export function reviewNotes(value) {
  const source = Array.isArray(value) ? value : [];
  const valid = source.filter(note => typeof note === 'string');
  const notes = valid.slice(0, MAX_REVIEW_NOTES).map(note => note.slice(0, MAX_REVIEW_NOTE_LENGTH));
  const condensed = valid.length > MAX_REVIEW_NOTES ||
    valid.some(note => note.length > MAX_REVIEW_NOTE_LENGTH);
  if (condensed) {
    if (notes.length === MAX_REVIEW_NOTES) notes.pop();
    notes.push(OMITTED);
  }
  return { notes, condensed: condensed || valid.length !== source.length };
}
