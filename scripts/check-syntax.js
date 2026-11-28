"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const IGNORE_DIRS = new Set([".git", "node_modules", "coverage", "playwright-report", "test-results"]);

function collectJsFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        collectJsFiles(path.join(dir, entry.name), results);
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

const files = collectJsFiles(ROOT_DIR).sort();
for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log(`语法检查通过：共检查 ${files.length} 个 JS 文件。`);
