import { checkShape, clone, fitPlay } from "./model.js";
const KEY = "gridpuzzle-session-v1";

// Persist the transcription AND its uncertainty atomically. Never serialize
// photographs/canvases, workers, solutions or history. An app reload must not
// turn an unconfirmed OCR reading into a trusted clue.
export function saveSession(storage, state) {
  storage.set(KEY, {
    puzzle: clone(state.puzzle),
    // Keep the combined list for older installations. New sessions distinguish
    // cell readings from cage structure so either can be reviewed independently.
    uncertain: [...new Set([...state.uncertain, ...(state.cageUncertain || [])])],
    cellUncertain: [...state.uncertain],
    cageUncertain: [...(state.cageUncertain || [])],
    needsReview: Boolean(state.needsReview),
    notes: [...state.notes],
    // Play answers are the user's own work; the solution they are checked
    // against is never stored.
    play: Array.isArray(state.play) ? [...state.play] : [],
    hints: [...(state.hints || [])],
  });
}
export function restoreSession(storage) {
  const saved = storage.get(KEY);
  const puzzle = saved?.puzzle ?? storage.get("gridpuzzle-puzzle-v1");
  if (!puzzle) return null;
  try {
    checkShape(puzzle);
  } catch {
    return null;
  } // Malformed/legacy state must not prevent startup.
  const indices = (values) => Array.isArray(values)
    ? [
        ...new Set(
          values.filter(
            (i) => Number.isInteger(i) && i >= 0 && i < puzzle.cells.length,
          ),
        ),
      ]
    : [];
  // Legacy flags have no reason attached: retain them as cell warnings rather
  // than guessing that a cage edit is enough to confirm an unread digit.
  const uncertain = indices(Array.isArray(saved?.cellUncertain) ? saved.cellUncertain : saved?.uncertain),
    cageUncertain = indices(saved?.cageUncertain),
    play = fitPlay(puzzle, saved?.play),
    hints = indices(saved?.hints).filter((i) => Number.isInteger(play[i]));
  const notes = Array.isArray(saved?.notes)
    ? saved.notes
        .filter((x) => typeof x === "string")
        .slice(0, 8)
        .map((x) => x.slice(0, 500))
    : [];
  return {
    puzzle: clone(puzzle),
    uncertain,
    cageUncertain,
    needsReview: Boolean(saved?.needsReview) || uncertain.length > 0 || cageUncertain.length > 0,
    notes,
    play,
    hints,
  };
}
