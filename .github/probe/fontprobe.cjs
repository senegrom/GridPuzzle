// Temporary probe for the scanner-setup pull request: what the browsers draw
// for the fonts the suites and the app use, so that two environments can be
// compared pixel for pixel. Prints one line per engine and drawing.
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const playwright = require("playwright");

// The families the suites write their test pictures in (scripts/*.cjs), at
// every size they draw.
const FAMILIES = ["Arial", "Times New Roman", "Courier New", "DejaVu Sans", "DejaVu Serif",
  "FreeSans", "FreeSerif", "Georgia", "serif", "sans-serif", "monospace"];
const SIZES = [24, 25, 26, 27, 28, 30, 32, 38, 40, 42, 48, 52, 58, 64, 70, 100, 130];
const SUITE_TEXT = "0123456789 47 Daily puzzle";
// What the app draws on canvases: the solution digits (app.js, stroked), the
// preview bar and the overlay digits (live-overlay.js) and the corner
// numbers (photo-flow.js), at their weights.
const APP_CANVAS = [
  ...[10, 20, 38, 60].map((size) => ({ font: `650 ${size}px -apple-system,Arial,sans-serif`, stroke: true })),
  ...[13, 23, 30].map((size) => ({ font: `600 ${size}px system-ui, sans-serif` })),
  ...[8, 14, 24, 40].map((size) => ({ font: `700 ${size}px system-ui, sans-serif` })),
  ...[12, 18, 30].map((size) => ({ font: `bold ${size}px sans-serif` })),
];
const APP_TEXT = "PREVIEW Read Check ? Unread ? Solution 0123456789";
// The page's own text (style.css): the body family at the weights and sizes
// it uses, the heading, the Georgia emphasis and the monospace text area.
const BODY = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const APP_CSS = [
  ...[400, 550, 600, 650, 750].flatMap((weight) =>
    [9, 12, 16, 20].map((size) => `font: ${weight} ${size}px ${BODY}`)),
  ...[45, 74].map((size) => `font: 650 ${size}px ${BODY}; letter-spacing: -3.2px`),
  ...[16, 45, 74].map((size) => `font: 550 ${size}px Georgia, serif`),
  `font: 400 12px ui-monospace, monospace`,
];
const DOM_TEXT = "Scan a puzzle · 9 × 9 · 27 printed clues — 0123456789";

function sh(command, args) {
  try { return execFileSync(command, args, { encoding: "utf8" }).trim(); } catch (error) { return `(${command} failed: ${error.message.split("\n")[0]})`; }
}

async function draw(page, font, text, stroke = false) {
  return page.evaluate(({ font, text, stroke }) => {
    const size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = font;
    const width = measure.measureText(text).width;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width + 16 + size * 0.2); canvas.height = Math.ceil(size * 2);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = stroke ? "#808080" : "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = font; ctx.textBaseline = "middle";
    if (stroke) {
      ctx.lineWidth = Math.max(2, size * 0.1); ctx.strokeStyle = "#ffffffee";
      ctx.strokeText(text, 8, canvas.height / 2);
      ctx.fillStyle = "#067c6b";
    } else ctx.fillStyle = "#000";
    ctx.fillText(text, 8, canvas.height / 2);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0x811c9dc5, ink = 0;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i]; hash = Math.imul(hash, 0x01000193) >>> 0;
      if (i % 4 === 0 && data[i] < 128) ink++;
    }
    return `${canvas.width}x${canvas.height} width=${Math.round(width * 100) / 100} ink=${ink} hash=${hash.toString(16).padStart(8, "0")}`;
  }, { font, text, stroke });
}

async function main() {
  console.log("os:", sh("sh", ["-c", ". /etc/os-release; echo $PRETTY_NAME"]), "| host:", sh("sh", ["-c", "[ -r /run/host/os-release ] && . /run/host/os-release && echo $PRETTY_NAME || echo none"]));
  console.log("playwright:", require("playwright/package.json").version);
  console.log("docker-info:", fs.existsSync("/ms-playwright/.docker-info") ? fs.readFileSync("/ms-playwright/.docker-info", "utf8").replace(/\s+/g, " ") : "none");
  for (const name of ["chromium", "webkit"]) console.log(`executable ${name}:`, playwright[name].executablePath());
  const patterns = [...FAMILIES, "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "ui-monospace", "Lato",
    "sans-serif:weight=600", "sans-serif:bold", "serif:bold", "Arial:bold", "Georgia:weight=550"];
  for (const pattern of patterns) console.log(`fc-match ${pattern}:`, sh("fc-match", ["-f", "%{family[0]}|%{style[0]}|%{file}", pattern]));
  console.log("fc-match -s sans-serif:", sh("fc-match", ["-s", "-f", "%{family[0]}\n", "sans-serif"]).split("\n").slice(0, 12).join("; "));
  console.log("fc-match -s serif:", sh("fc-match", ["-s", "-f", "%{family[0]}\n", "serif"]).split("\n").slice(0, 12).join("; "));
  const families = sh("fc-list", [":", "family"]).split("\n").map((line) => line.trim()).filter(Boolean).sort();
  console.log(`fc-list: ${new Set(families).size} families:`, [...new Set(families)].join("; "));
  for (const name of ["chromium", "webkit"]) {
    const browser = await playwright[name].launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>probe</title>");
    console.log(`version ${name}:`, browser.version());
    for (const size of SIZES)
      for (const family of FAMILIES)
        console.log(`draw ${name} suite ${size}px ${family}:`, await draw(page, `${size}px ${family}`, SUITE_TEXT));
    for (const { font, stroke } of APP_CANVAS)
      console.log(`draw ${name} app ${font}${stroke ? " stroked" : ""}:`, await draw(page, font, APP_TEXT, stroke));
    await page.setContent("<!doctype html><meta charset=utf-8><title>probe</title>"
      + "<style>body{margin:0;background:#fff;color:#000}div{display:inline-block;padding:4px;white-space:nowrap}</style>"
      + APP_CSS.map((style, index) => `<div id=d${index} style='${style}'>${DOM_TEXT}</div><br>`).join(""));
    for (const [index, style] of APP_CSS.entries()) {
      const box = await page.locator(`#d${index}`).boundingBox();
      const png = await page.locator(`#d${index}`).screenshot();
      console.log(`dom ${name} ${style}: ${Math.round(box.width * 100) / 100}x${Math.round(box.height * 100) / 100} sha256=${crypto.createHash("sha256").update(png).digest("hex").slice(0, 16)}`);
    }
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
