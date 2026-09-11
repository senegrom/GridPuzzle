import { clone, checkShape, fitPlay, fitBlackReadings } from "./model.js";
export function captureEdit(state) {
  return {
    puzzle: clone(state.puzzle),
    layout: state.layout ? clone(state.layout) : null,
    uncertain: [...state.uncertain],
    blackReadings: fitBlackReadings(state.puzzle, state.blackReadings),
    cageUncertain: [...(state.cageUncertain || [])],
    needsReview: state.needsReview,
    notes: [...state.notes],
    source: state.puzzleSource,
    play: Array.isArray(state.play) ? [...state.play] : [],
    hints: [...(state.hints || [])],
  };
}
export function restoreEdit(state, snapshot) {
  state.puzzle = snapshot.puzzle;
  state.layout = snapshot.layout || null;
  state.blackReadings = fitBlackReadings(state.puzzle, snapshot.blackReadings);
  state.uncertain = new Set([...snapshot.uncertain, ...state.blackReadings.map((e) => e.cell)]);
  state.cageUncertain = new Set(snapshot.cageUncertain || []);
  state.needsReview = snapshot.needsReview;
  state.notes = snapshot.notes;
  state.puzzleSource = snapshot.source;
  state.selected = [];
  state.play = fitPlay(state.puzzle, snapshot.play);
  state.hints = new Set(
    (snapshot.hints || []).filter((i) => Number.isInteger(state.play[i])),
  );
  state.playFeedback = null;
}
export function rememberEdit(state) {
  state.history.push(captureEdit(state));
  if (state.history.length > 30) state.history.shift();
}

// Stage only editable data, not results, history, photo resources or tasks.
// A rejected edit must leave the accepted state (including object identity)
// untouched. Callers commit this draft only after all validation succeeds.
export function prepareEdit(state, edit) {
  const draft = {};
  restoreEdit(draft, captureEdit(state));
  draft.selected = [...state.selected];
  edit(draft);
  checkShape(draft.puzzle);
  draft.blackReadings = fitBlackReadings(draft.puzzle, draft.blackReadings);
  draft.play = fitPlay(draft.puzzle, draft.play);
  draft.hints = new Set(
    [...draft.hints].filter((i) => Number.isInteger(draft.play[i])),
  );
  return draft;
}
