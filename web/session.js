import {checkShape,clone} from './model.js';
const KEY='gridpuzzle-session-v1';

// Persist the transcription AND its uncertainty atomically. Never serialize
// photographs/canvases, workers, solutions or history. An app reload must not
// turn an unconfirmed OCR reading into a trusted clue.
export function saveSession(storage,state){
  storage.set(KEY,{puzzle:clone(state.puzzle),uncertain:[...state.uncertain],
    needsReview:Boolean(state.needsReview),notes:[...state.notes]});
}
export function restoreSession(storage){
  const saved=storage.get(KEY);
  const puzzle=saved?.puzzle??storage.get('gridpuzzle-puzzle-v1');
  if(!puzzle)return null;
  checkShape(puzzle);
  const uncertain=Array.isArray(saved?.uncertain)?[...new Set(saved.uncertain.filter(i=>Number.isInteger(i)&&i>=0&&i<puzzle.cells.length))]:[];
  const notes=Array.isArray(saved?.notes)?saved.notes.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,500)):[];
  return {puzzle:clone(puzzle),uncertain,needsReview:Boolean(saved?.needsReview)||uncertain.length>0,notes};
}
