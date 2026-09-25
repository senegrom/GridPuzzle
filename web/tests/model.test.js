import test from "node:test";
import assert from "node:assert/strict";
import {
  makePuzzle,
  checkShape,
  conflicts,
  demo,
  fitPlay,
  playConflicts,
  TYPES,
  classify,
  checkSolveReady,
  hasCageRemoval,
  hasInequalityRemoval,
  moveIndex,
  normalizePuzzle,
} from "../model.js";
import {
  homography,
  project,
  warp,
  validQuad,
  threshold,
  findGrid,
  estimateGrid,
} from "../geometry.js";

test("All family demos have bounded, valid row-major shapes", () => {
  for (const type of Object.keys(TYPES)) {
    const p = demo(type);
    assert.equal(checkShape(p), p);
    assert.equal(p.cells.length, p.rows * p.cols);
  }
});
test("Zero is preserved only for Slitherlink", () => {
  const p = makePuzzle("slitherlink", 1);
  p.cells = [0];
  assert.equal(checkShape(p).cells[0], 0);
  p.type = "sudoku";
  assert.throws(() => checkShape(p));
});
test("Bad input is rejected before rendering", () => {
  for (const p of [
    null,
    {},
    { ...makePuzzle(), type: "bad" },
    { ...demo(), rows: 26 },
    { ...demo(), cells: [true] },
    { ...demo(), extra: "ignored" },
  ])
    assert.throws(() => checkShape(p));
});
test("Duplicate clues mark BOTH cells", () => {
  const p = makePuzzle("sudoku", 4);
  p.cells[0] = p.cells[1] = 2;
  assert.deepEqual([...conflicts(p)].sort(), [0, 1]);
});
test("Ambiguous path rules require confirmation", () => {
  const a = classify({ rows: 5, cols: 5, values: [1, 25] });
  assert.equal(a.type, "numbrix");
  assert.equal(a.review, true);
});
test("Visible inequalities are not treated as Sudoku", () => {
  assert.equal(classify({ rows: 5, cols: 5, signs: 3 }).type, "futoshiki");
});
test("Projective corner correspondence and affine identity", () => {
  const q = [
      { x: 2, y: 3 },
      { x: 97, y: 8 },
      { x: 89, y: 94 },
      { x: 9, y: 82 },
    ],
    m = homography(q);
  for (const [i, [u, v]] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].entries()) {
    const p = project(m, u, v);
    assert.ok(Math.abs(p.x - q[i].x) < 1e-7);
    assert.ok(Math.abs(p.y - q[i].y) < 1e-7);
  }
  assert.equal(validQuad(q, 100, 100), true);
  assert.equal(validQuad([q[0], q[2], q[1], q[3]], 100, 100), false);
});
function image(w, h, value = 255) {
  const data = new Uint8ClampedArray(w * h * 4).fill(value);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: w, height: h, data };
}
test("Uniform white has no false ink or confident grid", () => {
  const a = image(120, 120);
  assert.equal(
    threshold(a).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(findGrid(a).confidence, 0);
});
test("Warp preserves orientation", () => {
  const a = image(40, 40);
  for (let i = 0; i < 40 * 40; i++) {
    a.data[4 * i] = i % 40;
    a.data[4 * i + 1] = Math.floor(i / 40);
  }
  const out = warp(
    a,
    [
      { x: 0, y: 0 },
      { x: 39, y: 0 },
      { x: 39, y: 39 },
      { x: 0, y: 39 },
    ],
    40,
    40,
  );
  assert.deepEqual(out.data, a.data);
});
test("Synthetic connected 9x9 grid is detected", () => {
  const a = image(420, 420);
  for (let y = 20; y <= 398; y++)
    for (let x = 20; x <= 398; x++) {
      const vx = (x - 20) % 42,
        vy = (y - 20) % 42;
      if (vx < 2 || vy < 2) {
        const i = (y * 420 + x) * 4;
        a.data[i] = a.data[i + 1] = a.data[i + 2] = 0;
      }
    }
  const found = findGrid(a);
  assert.ok(found.confidence > 0.8);
  assert.equal(found.rows, 9);
  assert.equal(found.cols, 9);
});

test("Construction validates type before allocating", () =>
  assert.throws(() => makePuzzle("bad")));


test("Str8ts black cells can be blank or numbered", () => {
  const p = makePuzzle("str8ts", 3);
  p.black = [4]; p.cells[4] = 3; assert.equal(checkShape(p), p);
  p.cells[4] = "#"; assert.equal(checkShape(p), p);
  assert.equal(classify({rows:9,cols:9,values:[9,1,4],black:12,blackNumbers:2,triangles:0,boxes:false}).type, "str8ts");
});

test('automatically identified boxed Sudoku still requires one rules confirmation',()=>{
  const result=classify({rows:9,cols:9,boxes:true,values:[5,3,7]});
  assert.equal(result.type,'sudoku');assert.equal(result.review,true);
});

test('browser validation rejects disconnected/overlapping/bad-arity cages early',()=>{
  const p=makePuzzle('kenken',4);p.cages=[{cells:[0,2],target:3,op:'+'}];assert.throws(()=>checkShape(p),/connected/);
  p.cages=[{cells:[0,1],target:3,op:'+'},{cells:[1,2],target:4,op:'+'}];assert.throws(()=>checkShape(p),/overlap/);
  p.cages=[{cells:[0,1,2],target:1,op:'-'}];assert.throws(()=>checkShape(p),/exactly two/);
  p.cages=[{cells:[0,1],target:1,op:'='}];assert.throws(()=>checkShape(p),/exactly one/);
});

test('Kakuro clue objects need at least one direction',()=>{
  const p=makePuzzle('kakuro',3);p.cells[0]='#';p.clues=[{cell:0}];assert.throws(()=>checkShape(p),/across or down/);
});

test("board navigation never wraps across rows or columns", () => {
  assert.equal(moveIndex(8, "ArrowRight", 9, 9), 8);
  assert.equal(moveIndex(9, "ArrowLeft", 9, 9), 9);
  assert.equal(moveIndex(4, "ArrowUp", 9, 9), 4);
  assert.equal(moveIndex(76, "ArrowDown", 9, 9), 76);
  assert.equal(moveIndex(10, "ArrowRight", 9, 9), 11);
  assert.equal(moveIndex(10, "ArrowDown", 9, 9), 19);
  assert.equal(moveIndex(10, "Enter", 9, 9), 10);
});

test("removal guards depend on puzzle state, not on editor text", () => {
  const p = { cages: [{ cells: [0, 1] }], inequalities: [{ less: 4, greater: 5 }] };
  assert.equal(hasCageRemoval(p, []), false);
  assert.equal(hasCageRemoval(p, [7]), false);
  assert.equal(hasCageRemoval(p, [1]), true);
  assert.equal(hasInequalityRemoval(p, [4]), false);
  assert.equal(hasInequalityRemoval(p, [4, 6]), false);
  assert.equal(hasInequalityRemoval(p, [4, 5]), true);
  assert.equal(hasCageRemoval(makePuzzle("sudoku", 4), [0]), false);
});

test("solve-ready cages require targets and complete coverage", () => {
  const p = makePuzzle("kenken", 4);
  p.cages = [{ cells: [0], target: 1, op: "=" }];
  assert.throws(() => checkSolveReady(p), /cover every cell/);
  p.cages = Array.from({ length: 16 }, (_, i) => ({
    cells: [i],
    target: (i % 4) + 1,
    op: "=",
  }));
  assert.doesNotThrow(() => checkSolveReady(p));
  p.cages[0].target = null;
  assert.throws(() => checkSolveReady(p), /target/);
  assert.doesNotThrow(() => checkSolveReady(makePuzzle("sudoku", 4)));
});

test("solve-ready Kakuro localizes missing and too-short runs before Python loads", () => {
  const p = makePuzzle("kakuro", 3);
  p.cells = ["#", "#", "#", "#", null, null, "#", null, null];
  p.clues = [
    { cell: 1, down: 4 },
    { cell: 2, down: 6 },
    { cell: 3, across: 3 },
    { cell: 6, across: 7 },
  ];
  assert.doesNotThrow(() => checkSolveReady(p));
  p.clues = p.clues.filter((q) => q.cell !== 6);
  assert.throws(() => checkSolveReady(p), /exactly one across and one down run/);
  const q = makePuzzle("kakuro", 2);
  q.cells = ["#", null, "#", "#"];
  q.clues = [{ cell: 0, across: 1 }];
  assert.throws(() => checkSolveReady(q), /2 to 9/);
});

// --- model / persistence guards --------------------------------------------
test("a Str8ts # outside the black list is reported as such, not as an out-of-range value", () => {
  const p = makePuzzle("str8ts", 3);
  p.cells[4] = "#";
  assert.throws(() => checkShape(p), /listed as black/);
});

for (const op of [null, "", false, {}, 1])
  test(`invalid cage operator ${JSON.stringify(op)} fails before Python starts`, () => {
    const p = makePuzzle("kenken", 2);
    p.cages = [1, 2, 2, 1].map((target, i) => ({ cells: [i], target, op }));
    assert.throws(() => normalizePuzzle(p), /operator/);
    assert.throws(() => checkSolveReady(p), /operator/);
  });

test("omitted and explicit sum operators remain accepted", () => {
  for (const op of [undefined, "+"]) {
    const p = makePuzzle("kenken", 2);
    p.cages = [1, 2, 2, 1].map((target, i) => ({ cells: [i], target, ...(op === undefined ? {} : { op }) }));
    assert.doesNotThrow(() => checkSolveReady(normalizePuzzle(p)));
  }
});
test('Kakuro duplicate and impossible partial sums have immediate feedback while valid answers do not',()=>{
 const p=demo('kakuro'),play=fitPlay(p,[]);play[5]=1;
 assert.ok(playConflicts(p,play).has(5));play[5]=2;assert.equal(playConflicts(p,play).size,0);
 const q=makePuzzle('kakuro',3,3);q.cells=['#','#','#','#',null,null,'#',null,null];q.clues=[{cell:3,across:17}];
 q.cells[4]=1;assert.ok(conflicts(q).has(4));q.cells[4]=8;assert.equal(conflicts(q).size,0);
});
test('Killer cages enforce distinct digits across different rows and boxes',()=>{
 const p=makePuzzle('killersudoku',4);p.cages=[{cells:[1,2,6],target:6,op:'+'}];p.cells[1]=1;p.cells[2]=4;p.cells[6]=1;
 assert.ok(conflicts(p).has(6));p.cells[2]=3;p.cells[6]=2;assert.equal(conflicts(p).size,0);
 p.cells[6]=null;p.cages[0].target=20;assert.ok(conflicts(p).has(1));
});
for (const [op,target,invalid,valid] of [['+',3,[1,3],[1,2]],['*',6,[1,2],[2,3]],['-',2,[1,2],[1,3]],['/',3,[2,3],[1,3]]])
 test(`KenKen ${op} cage arithmetic is checked without changing puzzle data`,()=>{
  const p=makePuzzle('kenken',4);p.cages=[{cells:[0,1],target,op}];
  [p.cells[0],p.cells[1]]=invalid;const before=JSON.stringify(p);assert.ok(conflicts(p).has(0));assert.equal(JSON.stringify(p),before);
  [p.cells[0],p.cells[1]]=valid;assert.equal(conflicts(p).size,0);
 });
test('KenKen products use exact integers and do not reject possible partial cages',()=>{
 const p=makePuzzle('kenken',4);p.cages=[{cells:[0,1],target:6,op:'*'}];p.cells[0]=2;assert.equal(conflicts(p).size,0);
 p.cells[0]=4;assert.ok(conflicts(p).has(0));
});
