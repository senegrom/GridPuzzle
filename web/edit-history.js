import { clone } from "./model.js";
export function captureEdit(state) {
  return {
    puzzle: clone(state.puzzle),
    layout: state.layout ? clone(state.layout) : null,
    uncertain: [...state.uncertain],
    cageUncertain: [...(state.cageUncertain || [])],
    needsReview: state.needsReview,
    notes: [...state.notes],
    source: state.puzzleSource,
  };
}
export function restoreEdit(state, snapshot) {
  state.puzzle = snapshot.puzzle;
  state.layout = snapshot.layout || null;
  state.uncertain = new Set(snapshot.uncertain);
  state.cageUncertain = new Set(snapshot.cageUncertain || []);
  state.needsReview = snapshot.needsReview;
  state.notes = snapshot.notes;
  state.puzzleSource = snapshot.source;
  state.selected = [];
}
export function rememberEdit(state) {
  state.history.push(captureEdit(state));
  if (state.history.length > 30) state.history.shift();
}
