from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    s = p.read_text(encoding="utf-8")
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 match in {path}, found {n}")
    p.write_text(s.replace(old, new), encoding="utf-8")


p = "gridsolver/web_api.py"
rep(p, "from gridsolver.grid_classes.slitherlink import Slitherlink\n", "from gridsolver.grid_classes.slitherlink import Slitherlink\nfrom gridsolver.grid_classes.str8ts import Str8ts\n", "web api import")
rep(p, "    'kakuro', 'slitherlink',\n)", "    'kakuro', 'slitherlink', 'str8ts',\n)", "web api types")
rep(p, "            'cells', 'cages', 'inequalities', 'clues'}", "            'cells', 'cages', 'inequalities', 'clues', 'black'}", "web api allowed")
rep(p, "    clues = _array(p.get('clues', []), 'clues', count)\n", "    clues = _array(p.get('clues', []), 'clues', count)\n    black_raw = _array(p.get('black', []), 'black', count)\n    black_cells = {_integer(i, 'Black cell', 0, count - 1) for i in black_raw}\n    if len(black_cells) != len(black_raw):\n        raise ValueError('Black cells must be distinct')\n    if black_cells and kind != 'str8ts':\n        raise ValueError('Black-cell metadata is only supported for Str8ts')\n", "web api black")
rep(p, "    dense = kind not in ('hidato', 'numbrix', 'kakuro', 'slitherlink')\n", "    dense = kind not in ('hidato', 'numbrix', 'kakuro', 'slitherlink', 'str8ts')\n", "web api compact")
rep(p, "    if blocked and kind not in ('hidato', 'kakuro'):\n        raise ValueError('Blocked cells are only supported in Hidato and Kakuro')\n", "    if blocked and kind not in ('hidato', 'kakuro', 'str8ts'):\n        raise ValueError('Blocked cells are only supported in Hidato, Kakuro and Str8ts')\n    if kind == 'str8ts':\n        if rows != cols or rows > 9:\n            raise ValueError('Str8ts requires a square board no larger than 9x9')\n        if blocked - black_cells:\n            raise ValueError('Every # Str8ts cell must be listed in black')\n        if any(i in black_cells and raw[i] is None for i in range(count)):\n            raise ValueError('A Str8ts black cell must contain # or a numbered clue')\n", "web api blocks")
rep(p, "    elif kind == 'slitherlink':\n        grid = Slitherlink([values[r * cols:(r + 1) * cols] for r in range(rows)])\n    else:\n", "    elif kind == 'slitherlink':\n        grid = Slitherlink([values[r * cols:(r + 1) * cols] for r in range(rows)])\n    elif kind == 'str8ts':\n        numbered = {i for i in black_cells if isinstance(values[i], int)}\n        grid = Str8ts(rows, cols, black=[coord(i) for i in black_cells],\n                      numbered_black=[coord(i) for i in numbered])\n        grid.load_key_values({coord(i): value for i, value in enumerate(values)\n                              if isinstance(value, int)})\n    else:\n", "web api build")

p = "web/model.js"
rep(p, '  slitherlink: "Slitherlink",\n', '  slitherlink: "Slitherlink",\n  str8ts: "Str8ts",\n', "model type")
rep(p, "    clues: [],\n  };", "    clues: [],\n    black: [],\n  };", "model black field")
rep(p, '    "cells", "cages", "inequalities", "clues",\n', '    "cells", "cages", "inequalities", "clues", "black",\n', "model allowed")
old = '''  const maximum =
    p.type === "slitherlink"
      ? 4
      : ["hidato", "numbrix"].includes(p.type)
        ? p.cells.filter((v) => v !== "#").length
        : p.type === "kakuro"
          ? 9
          : p.rows;
'''
new = '''  const black = new Set(p.black || []);
  if (!Array.isArray(p.black || []) || black.size !== (p.black || []).length || [...black].some((i) => !Number.isInteger(i) || i < 0 || i >= p.cells.length))
    throw Error("Invalid black-cell metadata.");
  if (p.type !== "str8ts" && black.size)
    throw Error("Black-cell metadata is only supported for Str8ts.");
  if (p.type === "str8ts" && (p.rows !== p.cols || p.rows > 9))
    throw Error("Str8ts requires a square board no larger than 9 × 9.");
  const maximum =
    p.type === "slitherlink"
      ? 4
      : ["hidato", "numbrix"].includes(p.type)
        ? p.cells.filter((v) => v !== "#").length
        : p.type === "kakuro"
          ? 9
          : p.rows;
'''
rep(p, old, new, "model black validation")
rep(p, '    if (v === "#" && ["hidato", "kakuro"].includes(p.type)) return;\n', '    if (v === "#" && (["hidato", "kakuro"].includes(p.type) || (p.type === "str8ts" && black.has(i)))) return;\n', "model # support")
rep(p, '  for (const key of ["boxRows", "boxCols"])\n', '  if (p.type === "str8ts") {\n    for (const i of black) if (p.cells[i] === null) throw Error("A Str8ts black cell must contain # or a numbered clue.");\n    p.cells.forEach((v, i) => { if (v === "#" && !black.has(i)) throw Error("Every # Str8ts cell must be listed as black."); });\n  }\n  for (const key of ["boxRows", "boxCols"])\n', "model black consistency")
rep(p, '  if (type === "slitherlink") { const p = makePuzzle(type, 2); p.cells = [2, 2, 2, 2]; return p; }\n', '  if (type === "str8ts") { const p = makePuzzle(type, 3); p.black = [4]; p.cells = [1,2,3,2,3,1,3,1,null]; return p; }\n  if (type === "slitherlink") { const p = makePuzzle(type, 2); p.cells = [2, 2, 2, 2]; return p; }\n', "model demo")
rep(p, 'export function classify({ rows, cols, values = [], signs = 0, labels = 0, operators = 0, black = 0, triangles = 0, boxes = false, dots = false }) {\n', 'export function classify({ rows, cols, values = [], signs = 0, labels = 0, operators = 0, black = 0, blackNumbers = 0, triangles = 0, boxes = false, dots = false }) {\n', "model classify signature")
rep(p, '  if (black && triangles) return { type:"kakuro", review:true, reason:"Cross-sum layout detected. Check black cells and both clue directions." };\n', '  if (black && triangles) return { type:"kakuro", review:true, reason:"Cross-sum layout detected. Check black cells and both clue directions." };\n  if (black && blackNumbers && rows === cols && rows <= 9) return { type:"str8ts", review:true, reason:"Numbered black cells suggest Str8ts. Check every black cell and printed digit." };\n', "model classify Str8ts")

p = "web/scanner.js"
rep(p, '    const valueEntries = entries.filter((e) => e.kind === "value"),\n      values = Array(rows * cols).fill(null),\n      uncertain = new Set();\n', '    const valueEntries = entries.filter((e) => ["value", "blackvalue"].includes(e.kind)),\n      values = Array(rows * cols).fill(null),\n      blackValueCells = new Set(),\n      uncertain = new Set();\n', "scanner values")
rep(p, '    for (const e of valueEntries) {\n      if (/^\\d{1,3}$/.test(e.text)) values[e.cell] = +e.text;\n      if (values[e.cell] === null || e.confidence < 85) uncertain.add(e.cell);\n    }\n', '    for (const e of valueEntries) {\n      if (/^\\d{1,3}$/.test(e.text)) values[e.cell] = +e.text;\n      if (e.kind === "blackvalue" && values[e.cell] !== null) blackValueCells.add(e.cell);\n      if (values[e.cell] === null || e.confidence < 85) uncertain.add(e.cell);\n    }\n', "scanner black values")
rep(p, '      black: black.filter(Boolean).length,\n      triangles: triangles.length,\n', '      black: black.filter(Boolean).length,\n      blackNumbers: blackValueCells.size,\n      triangles: triangles.length,\n', "scanner classify")
rep(p, '    puzzle.cells = values.map((v, i) => {\n      if (black[i] && ["hidato", "kakuro"].includes(chosen)) return "#";\n', '    if (chosen === "str8ts") puzzle.black = black.flatMap((v, i) => v ? [i] : []);\n    puzzle.cells = values.map((v, i) => {\n      if (black[i] && chosen === "str8ts") { uncertain.add(i); return v === null ? "#" : v; }\n      if (black[i] && ["hidato", "kakuro"].includes(chosen)) return "#";\n', "scanner black output")
rep(p, '      ["futoshiki", "kakuro", "hidato", "numbrix", "slitherlink"].includes(\n', '      ["futoshiki", "kakuro", "hidato", "numbrix", "slitherlink", "str8ts"].includes(\n', "scanner review")
rep(p, '    if (isCage(chosen))\n      notes.unshift(\n        "Cage recognition is experimental. Check the entire partition: missing boundaries can merge cages.",\n      );\n', '    if (isCage(chosen))\n      notes.unshift(\n        "Cage recognition is experimental. Check the entire partition: missing boundaries can merge cages.",\n      );\n    if (chosen === "str8ts") notes.unshift("Str8ts black cells may be blank or numbered; check every black cell before solving.");\n', "scanner note")

p = "web/app.js"
rep(p, '    clues: clone(p.clues || []),\n  };\n', '    clues: clone(p.clues || []),\n    black: clone(p.black || []),\n  };\n', "app normalized")
rep(p, '      given = p.cells[i],\n      value = sol?.cells[i] ?? given;\n    const classes = ["board-cell"];\n    if (given === "#") classes.push("blocked");\n', '      given = p.cells[i],\n      value = sol?.cells[i] ?? given,\n      isBlack = given === "#" || (p.type === "str8ts" && (p.black || []).includes(i));\n    const classes = ["board-cell"];\n    if (isBlack) classes.push("blocked");\n', "app draw black")
rep(p, '      "aria-label": `Row ${r + 1}, column ${c + 1}: ${given === null ? "blank" : given === "#" ? "blocked" : given}${state.uncertain.has(i) ? ", check reading" : ""}`,\n', '      "aria-label": `Row ${r + 1}, column ${c + 1}: ${given === null ? "blank" : isBlack && Number.isInteger(given) ? `black clue ${given}` : given === "#" ? "blocked" : given}${state.uncertain.has(i) ? ", check reading" : ""}`,\n', "app aria")
rep(p, '      (next.clues.length && type !== "kakuro")\n', '      (next.clues.length && type !== "kakuro") ||\n      ((next.black || []).length && type !== "str8ts")\n', "app type preserve")
rep(p, '  $("blocked-cell").checked = p.cells[i] === "#";\n  $("block-option").hidden = !["hidato", "kakuro"].includes(p.type);\n', '  $("blocked-cell").checked = p.cells[i] === "#" || (p.type === "str8ts" && (p.black || []).includes(i));\n  $("block-option").hidden = !["hidato", "kakuro", "str8ts"].includes(p.type);\n', "app open cell")
rep(p, '  $("cell-value").disabled = $("blocked-cell").checked;\n', '  $("cell-value").disabled = $("blocked-cell").checked && state.puzzle.type !== "str8ts";\n', "app block input")
rep(p, '    next.cells[editing] = blocked ? "#" : numberInput("cell-value");\n', '    const entered = numberInput("cell-value");\n    if (next.type === "str8ts") {\n      next.black = (next.black || []).filter((i) => i !== editing);\n      if (blocked) next.black.push(editing);\n      next.black.sort((a, b) => a - b);\n      next.cells[editing] = blocked ? (entered ?? "#") : entered;\n    } else next.cells[editing] = blocked ? "#" : entered;\n', "app save black")

p = "web/style.css"
rep(p, '.board-cell.blocked .cell-hit {\n  fill: #173536;\n}\n', '.board-cell.blocked .cell-hit {\n  fill: #173536;\n}\n.board-cell.blocked > text {\n  fill: white;\n}\n', "css black text")

p = "scripts/browser_smoke.cjs"
rep(p, '        "slitherlink",\n      ]) {\n', '        "slitherlink",\n        "str8ts",\n      ]) {\n', "browser family")
rep(p, '      console.log(name, "all eleven solver families passed");\n', '      console.log(name, "all twelve solver families passed");\n', "browser family count")

with Path("web/tests/model.test.js").open("a", encoding="utf-8") as f:
    f.write('''\n\ntest("Str8ts black cells can be blank or numbered", () => {\n  const p = makePuzzle("str8ts", 3);\n  p.black = [4]; p.cells[4] = 3; assert.equal(checkShape(p), p);\n  p.cells[4] = "#"; assert.equal(checkShape(p), p);\n  assert.equal(classify({rows:9,cols:9,values:[9,1,4],black:12,blackNumbers:2,triangles:0,boxes:false}).type, "str8ts");\n});\n''')
with Path("tests/test_web_api.py").open("a", encoding="utf-8") as f:
    f.write('''\n\ndef test_browser_str8ts_numbered_black_cell():\n    from gridsolver.web_api import solve_payload\n    p = {\n        "version": 1, "type": "str8ts", "rows": 3, "cols": 3,\n        "black": [4],\n        "cells": [1, 2, 3, 2, 3, 1, 3, 1, None],\n        "cages": [], "inequalities": [], "clues": [],\n    }\n    result = solve_payload(p)\n    assert result["status"] == "unique"\n    assert result["solutions"][0]["cells"] == [1,2,3,2,3,1,3,1,2]\n''')
with Path("web/README.md").open("a", encoding="utf-8") as f:
    f.write('''\n\n### Real newspaper regressions and Str8ts\n\nThe scanner includes Str8ts as a twelfth solver family. Black cells are stored separately from their optional printed digits, so numbered black clues count for row/column uniqueness without joining a street. Real user-provided newspaper photos and hand-transcribed expected data live under `web/examples/newspaper/`. Newsprint OCR isolates the dominant connected glyph component before Tesseract to suppress paper speckle and shaded-cell halftone.\n''')

Path("web/scan-analysis.js").write_text(r'''import { isGridStroke } from "./ocr-map.js";
import { isCage } from "./model.js";
import { gray, thresholdGray, estimateGrid } from "./geometry.js";
function fraction(mask,w,h,x,y,rw,rh){let sum=0,n=0;for(let yy=Math.max(0,Math.floor(y));yy<Math.min(h,y+rh);yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(w,x+rw);xx++){sum+=mask[yy*w+xx];n++;}return sum/Math.max(1,n);}
function dominant(mask,w,h){const seen=new Uint8Array(mask.length),stack=[],parts=[];for(let start=0;start<mask.length;start++){if(!mask[start]||seen[start])continue;let area=0,minx=w,miny=h,maxx=-1,maxy=-1;seen[start]=1;stack.push(start);while(stack.length){const at=stack.pop(),y=Math.floor(at/w),x=at%w;area++;minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const next=yy*w+xx;if(mask[next]&&!seen[next]){seen[next]=1;stack.push(next);}}}parts.push({area,minx,miny,maxx,maxy});}parts.sort((a,b)=>b.area-a.area);return parts.find(p=>p.area>=Math.max(4,w*h*0.003)&&p.maxy-p.miny+1>=h*0.12)||null;}
export function prepareScan(image,type,rows,cols){const w=image.width,h=image.height,cw=w/cols,ch=h/rows,g=gray(image),mask=thresholdGray(g,w,h),dark=new Uint8Array(g.length);for(let i=0;i<g.length;i++)dark[i]=g[i]<125?1:0;const black=Array.from({length:rows*cols},(_,i)=>fraction(dark,w,h,((i%cols)+0.16)*cw,(Math.floor(i/cols)+0.16)*ch,0.68*cw,0.68*ch)>0.48),anyBlack=black.some(Boolean),entries=[];
function region(kind,cell,x,y,rw,rh,invert=false,other=null){x=Math.max(0,Math.round(x));y=Math.max(0,Math.round(y));rw=Math.max(1,Math.min(w-x,Math.round(rw)));rh=Math.max(1,Math.min(h-y,Math.round(rh)));const local=new Uint8Array(rw*rh);let minx=rw,miny=rh,maxx=-1,maxy=-1,ink=0;for(let yy=0;yy<rh;yy++)for(let xx=0;xx<rw;xx++){const val=invert?g[(y+yy)*w+x+xx]>165:mask[(y+yy)*w+x+xx];local[yy*rw+xx]=val?1:0;if(val){minx=Math.min(minx,xx);miny=Math.min(miny,yy);maxx=Math.max(maxx,xx);maxy=Math.max(maxy,yy);ink++;}}if(["value","blackvalue"].includes(kind)){const part=dominant(local,rw,rh);if(!part)return;({minx,miny,maxx,maxy}=part);ink=part.area;}if(ink<Math.max(4,rw*rh*0.008)||maxy-miny<Math.max(2,rh*0.1))return;if(kind==="label"&&(maxy>=rh-2||maxy-miny<3))return;let edgeInk=0;if(kind==="label"){const band=Math.max(1,Math.round(ch*0.03));for(let yy=miny;yy<=maxy;yy++)for(let xx=minx;xx<=maxx;xx++)if(yy<miny+band||xx<minx+band)edgeInk+=mask[(y+yy)*w+x+xx];}if(isGridStroke({kind,width:maxx-minx+1,height:maxy-miny+1,ink,edgeInk,regionWidth:rw,cellHeight:ch}))return;if(kind==="hsign"&&maxx-minx<(maxy-miny)*0.3)return;if(kind==="vsign"&&maxy-miny<(maxx-minx)*0.3)return;entries.push({kind,cell,other,x:x+minx,y:y+miny,w:maxx-minx+1,h:maxy-miny+1,invert,text:"",confidence:0});}
for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const i=r*cols+c;if(black[i]&&["auto","kakuro","hidato","str8ts"].includes(type)){if(type==="auto"||type==="str8ts")region("blackvalue",i,(c+0.16)*cw,(r+0.16)*ch,0.68*cw,0.68*ch,true);if(type==="auto"||type==="kakuro"){region("across",i,(c+0.48)*cw,(r+0.04)*ch,0.46*cw,0.4*ch,true);region("down",i,(c+0.05)*cw,(r+0.55)*ch,0.4*cw,0.4*ch,true);}}else region("value",i,(c+0.14)*cw,(r+0.16)*ch,0.72*cw,0.72*ch);if((type==="auto"&&!anyBlack)||isCage(type))region("label",i,(c+0.04)*cw,(r+0.015)*ch,0.7*cw,0.255*ch);if((type==="auto"&&!anyBlack)||type==="futoshiki"){if(c<cols-1)region("hsign",i,(c+0.82)*cw,(r+0.25)*ch,0.36*cw,0.5*ch,false,i+1);if(r<rows-1)region("vsign",i,(c+0.25)*cw,(r+0.82)*ch,0.5*cw,0.36*ch,false,i+cols);}}
return {image,meta:estimateGrid(image,mask),mask,g,black,entries};}
''', encoding="utf-8")
