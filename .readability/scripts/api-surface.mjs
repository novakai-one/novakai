#!/usr/bin/env node
// .readability/scripts/api-surface.mjs
//
// Emits .d.ts declaration files for the whole src/ tree via tsc, normalizes
// each one (strip comments/blank lines, collapse whitespace, trim), hashes
// the normalized text, and writes a baseline API-surface fingerprint to
// .readability/api-surface.json. The temp declaration output directory is
// deleted again once the fingerprint has been captured.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const dtsTmpDir = path.join(repoRoot, ".readability", ".dts-tmp");

const MODULE_CATEGORIES = [
  "src/core",
  "src/panel",
  "src/interaction",
  "src/render",
  "src/io",
  "src/main.ts",
];

function emitDeclarations() {
  rmSync(dtsTmpDir, { recursive: true, force: true });
  mkdirSync(dtsTmpDir, { recursive: true });
  // Must succeed — the repo tsconfig has no `noEmit` set, so these flags work.
  execFileSync(
    "npx",
    [
      "tsc",
      "-p",
      "tsconfig.json",
      "--declaration",
      "--emitDeclarationOnly",
      "--outDir",
      dtsTmpDir,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function walkDts(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walkDts(full));
    } else if (entry.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

function normalize(text) {
  const noBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLineComments = noBlockComments.replace(/\/\/.*$/gm, "");
  const lines = noLineComments
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  return lines.join("\n");
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function moduleForSrcRelativePath(srcRelPath) {
  if (srcRelPath === "main.d.ts") return "src/main.ts";
  const match = srcRelPath.match(/^(core|panel|interaction|render|io)\//);
  if (match) return `src/${match[1]}`;
  return null;
}

function buildFiles(dtsPaths) {
  const files = {};
  for (const abs of dtsPaths) {
    const srcRelPath = path.relative(dtsTmpDir, abs).split(path.sep).join("/");
    const normalized = normalize(readFileSync(abs, "utf8"));
    files[srcRelPath] = { normalized, hash: sha256(normalized) };
  }
  return files;
}

function buildModules(files) {
  const byModule = Object.fromEntries(MODULE_CATEGORIES.map((mod) => [mod, []]));
  for (const [srcRelPath, entry] of Object.entries(files)) {
    const mod = moduleForSrcRelativePath(srcRelPath);
    if (mod && mod in byModule) {
      byModule[mod].push(entry.hash);
    }
  }
  const modules = {};
  for (const [mod, hashes] of Object.entries(byModule)) {
    if (hashes.length === 0) continue;
    modules[mod] = sha256(hashes.slice().sort().join(""));
  }
  return modules;
}

function main() {
  emitDeclarations();
  const dtsPaths = walkDts(dtsTmpDir);
  const files = buildFiles(dtsPaths);
  const modules = buildModules(files);

  const outPath = path.join(repoRoot, ".readability", "api-surface.json");
  writeFileSync(outPath, `${JSON.stringify({ files, modules }, null, 2)}\n`);

  rmSync(dtsTmpDir, { recursive: true, force: true });

  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
}

main();
