// Temporary probe for the scanner-setup pull request: what the browsers draw
// for the font families the suites name, so that two environments can be
// compared pixel for pixel. Prints one line per engine, family and size.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const playwright = require("playwright");

const FAMILIES = ["Arial", "Times New Roman", "Courier New", "DejaVu Sans", "DejaVu Serif",
  "FreeSans", "FreeSerif", "Georgia", "serif", "sans-serif", "monospace"];
const SIZES = [38, 25];

function sh(command, args) {
  try { return execFileSync(command, args, { encoding: "utf8" }).trim(); } catch (error) { return `(${command} failed: ${error.message.split("\n")[0]})`; }
}

async function main() {
  console.log("os:", sh("sh", ["-c", ". /etc/os-release; echo $PRETTY_NAME"]), "| kernel:", sh("uname", ["-r"]));
  console.log("playwright:", require("playwright/package.json").version);
  console.log("docker-info:", fs.existsSync("/ms-playwright/.docker-info") ? fs.readFileSync("/ms-playwright/.docker-info", "utf8").replace(/\s+/g, " ") : "none");
  for (const name of ["chromium", "webkit"]) console.log(`executable ${name}:`, playwright[name].executablePath());
  for (const family of FAMILIES) console.log(`fc-match ${family}:`, sh("fc-match", ["-f", "%{family[0]}|%{style[0]}|%{file}", family]));
  const families = sh("fc-list", [":", "family"]).split("\n").map((line) => line.trim()).filter(Boolean).sort();
  console.log(`fc-list: ${new Set(families).size} families:`, [...new Set(families)].join("; "));
  for (const name of ["chromium", "webkit"]) {
    const browser = await playwright[name].launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>probe</title>");
    console.log(`version ${name}:`, browser.version());
    for (const size of SIZES) {
      for (const family of FAMILIES) {
        const result = await page.evaluate(({ family, size }) => {
          const canvas = document.createElement("canvas");
          canvas.width = 640; canvas.height = 80;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#000"; ctx.textBaseline = "middle";
          ctx.font = `${size}px ${family}`;
          ctx.fillText("0123456789 47", 8, 40);
          const width = ctx.measureText("0123456789 47").width;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let hash = 0x811c9dc5, ink = 0;
          for (let i = 0; i < data.length; i += 4) {
            const v = data[i];
            if (v < 128) ink++;
            hash ^= v; hash = Math.imul(hash, 0x01000193) >>> 0;
          }
          return { width: Math.round(width * 100) / 100, hash: hash.toString(16).padStart(8, "0"), ink };
        }, { family, size });
        console.log(`draw ${name} ${size}px ${family}: width=${result.width} ink=${result.ink} hash=${result.hash}`);
      }
    }
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
