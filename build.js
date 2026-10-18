"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const templatePath = path.join(root, "src", "index.template.html");
const stylePath = path.join(root, "src", "style.css");
const outputPath = path.join(root, "index.html");
const scriptFiles = [
  "glutil.js",
  "cube.js",
  "algs.js",
  "solver.js",
  "geometry.js",
  "renderer.js",
  "graph.js",
  "app.js",
];

function readNormalized(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

const template = readNormalized(templatePath);
const style = readNormalized(stylePath);
const scripts = scriptFiles.map((name) => {
  const filePath = path.join(root, "src", name);
  return `/* ${name} */\n${readNormalized(filePath)}`;
}).join("\n\n");

let output = template
  .replace("/*__STYLE__*/", () => style.trimEnd())
  .replace("/*__SCRIPT__*/", () => scripts.trimEnd());

const forbiddenPatterns = [
  /<script[^>]+\bsrc\s*=/i,
  /<link[^>]+\bhref\s*=\s*["']https?:/i,
  /@import\b/i,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /https?:\/\//i,
];
for (const pattern of forbiddenPatterns) {
  if (pattern.test(output)) throw new Error(`产物包含外部依赖或网络调用：${pattern}`);
}
if (/console\.log\s*\(/.test(output)) {
  throw new Error("产物不得包含 console.log。");
}

output = `${output.trimEnd()}\n`;
fs.writeFileSync(outputPath, output, "utf8");
const digest = crypto.createHash("sha256").update(output, "utf8").digest("hex");
process.stdout.write(`index.html ${Buffer.byteLength(output)} bytes sha256 ${digest}\n`);
