import { clone } from "./model.js";
export function captureEdit(state) {
  return {
    puzzle: clone(state.puzzle),
    uncertain: [...state.uncertain],
    needsReview: state.needsReview,
    notes: [...state.notes],
    source: state.puzzleSource,
  };
}
export function restoreEdit(state, snapshot) {
  state.puzzle = snapshot.puzzle;
  state.uncertain = new Set(snapshot.uncertain);
  state.needsReview = snapshot.needsReview;
  state.notes = snapshot.notes;
  state.puzzleSource = snapshot.source;
  state.selected = [];
}
export function rememberEdit(state) {
  state.history.push(captureEdit(state));
  if (state.history.length > 30) state.history.shift();
}
