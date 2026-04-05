/**
 * Splits src/brain/monolith.source.js → src/brain/chunks/*.js (single scope when concatenated in runtime.js).
 * Run: node tools/split-brain-chunks.js
 * Day-to-day: edit files under src/brain/chunks/ ; runtime.js loads them.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const bundlePath = path.join(root, "src", "brain", "monolith.source.js");
const outDir = path.join(root, "src", "brain", "chunks");

const lines = fs.readFileSync(bundlePath, "utf8").split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join("\n");

const ranges = [
  [15, 525, "01-arabic-reply-caches-intro.js"],
  [530, 967, "02-corrections-faq-roots.js"],
  [968, 1680, "03-search-engine.js"],
  [1681, 1838, "04-cards-and-logging.js"],
  [1840, 4225, "05-session-analyzer-pipeline.js"],
  [4227, 8004, "06-smartchat-orchestrator.js"],
];

fs.mkdirSync(outDir, { recursive: true });

for (const [from, to, name] of ranges) {
  let body = slice(from, to);
  if (name === "06-smartchat-orchestrator.js") {
    body = body.replace(
      /'Authorization':\s*'Bearer '\s*\+\s*OPENAI_API_KEY/g,
      "'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY"
    );
  }
  fs.writeFileSync(path.join(outDir, name), body + "\n");
}

console.log("Wrote", ranges.length, "chunks to", outDir);
