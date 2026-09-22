import { normalizePuzzle, fitPlay, fitBlackReadings, clone } from "./model.js";
import { saveSession, restoreSession, MAX_REVIEW_NOTES, MAX_REVIEW_NOTE_LENGTH } from "./session.js";

const FORMAT = "gridpuzzle-backup";
function object(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw Error(`Invalid ${name}.`);
}
// Session metadata lives outside the strict puzzle schema. Photos, computed
// solutions and workers are deliberately excluded; no imported code executes.
export function createBackup(state, editing = "value") {
  let session;
  saveSession({ set: (_key, value) => { session = value; } }, state);
  const backup = { format: FORMAT, version: 1, editing: editing === "play" ? "play" : "value", session };
  parsePuzzleFile(backup); // Never offer a backup that cannot be read back.
  return backup;
}
export function parsePuzzleFile(payload) {
  if (payload?.format !== FORMAT) {
    const puzzle = normalizePuzzle(payload);
    return { puzzle, uncertain: [], cageUncertain: [], blackReadings: [],
      needsReview: true, notes: ["Imported puzzle definition: check its clues and rules before solving. This format has no saved review state or Play progress."],
      play: fitPlay(puzzle, []), hints: [], editing: "value" };
  }
  object(payload, ["format", "version", "editing", "session"], "backup");
  if (payload.version !== 1) throw Error("Unsupported backup version. Update the app before importing it.");
  if (!["value", "play"].includes(payload.editing)) throw Error("Invalid backup editing mode.");
  const s = payload.session;
  object(s, ["puzzle", "uncertain", "cellUncertain", "cageUncertain", "blackReadings", "needsReview", "notes", "play", "hints"], "backup session");
  const puzzle = normalizePuzzle(s.puzzle), size = puzzle.cells.length;
  const indices = (list) => Array.isArray(list) && list.length <= size &&
    list.every(i => Number.isInteger(i) && i >= 0 && i < size) && new Set(list).size === list.length;
  if (![s.uncertain, s.cellUncertain, s.cageUncertain, s.hints].every(indices) ||
      typeof s.needsReview !== "boolean" || !Array.isArray(s.notes) || s.notes.length > MAX_REVIEW_NOTES ||
      !s.notes.every(note => typeof note === "string" && note.length <= MAX_REVIEW_NOTE_LENGTH))
    throw Error("Invalid backup review metadata.");
  const combined = new Set([...s.cellUncertain, ...s.cageUncertain]);
  if (s.uncertain.length !== combined.size || s.uncertain.some(i => !combined.has(i)))
    throw Error("Inconsistent backup review flags; nothing was imported.");
  const fittedPlay = fitPlay(puzzle, s.play);
  if (!Array.isArray(s.play) || s.play.length !== size ||
      s.play.some((value, i) => value !== fittedPlay[i]) ||
      s.hints.some(i => !Number.isInteger(s.play[i]))) throw Error("Invalid backup Play progress.");
  if (!Array.isArray(s.blackReadings) || s.blackReadings.length > size) throw Error("Invalid backup black-cell readings.");
  for (const item of s.blackReadings) object(item, ["cell", "value"], "black-cell reading");
  const fittedBlack = fitBlackReadings(puzzle, s.blackReadings);
  if (s.blackReadings.length !== fittedBlack.length ||
      s.blackReadings.some((item, i) => item.cell !== fittedBlack[i].cell || item.value !== fittedBlack[i].value))
    throw Error("Invalid backup black-cell readings.");
  const restored = restoreSession({ get: key => key === "gridpuzzle-session-v1" ? s : null });
  if (!restored) throw Error("Invalid backup session.");
  return { ...restored, puzzle, editing: payload.editing };
}
export function puzzleDefinition(state) {
  if (state.needsReview || state.uncertain?.size || state.cageUncertain?.size || state.blackReadings?.length)
    throw Error("This scan still needs review. Export a session backup to preserve its warnings, or review the clues before exporting a puzzle definition.");
  return clone(normalizePuzzle(state.puzzle));
}
