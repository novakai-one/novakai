#!/usr/bin/env node
// .readability/scripts/score.mjs
//
// Runs eslint over src + tools and writes a baseline warning-count scorecard
// to .readability/baseline-scores.json. Warnings never fail the build (all
// M6 readability rules are configured at "warn"), so a non-zero eslint exit
// code (which only happens on lint *errors*) is surfaced but does not stop
// this script from writing whatever JSON output eslint produced.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const MODULE_CATEGORIES = [
  "src/core",
  "src/panel",
  "src/interaction",
  "src/render",
  "src/io",
  "src/main.ts",
  "tools",
];

function runEslint() {
  try {
    return execFileSync(
      "npx",
      ["eslint", "src", "tools", "--format", "json"],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
    );
  } catch (err) {
    // eslint exits non-zero only when there are lint *errors*; our rules are
    // all "warn" so this should not normally trigger. Either way, eslint
    // still writes the JSON report to stdout, so recover it here.
    if (typeof err.stdout === "string" && err.stdout.length > 0) {
      return err.stdout;
    }
    throw err;
  }
}

function moduleForPath(relPath) {
  if (relPath === "src/main.ts") return "src/main.ts";
  const srcMatch = relPath.match(/^src\/(core|panel|interaction|render|io)\//);
  if (srcMatch) return `src/${srcMatch[1]}`;
  if (relPath.startsWith("tools/")) return "tools";
  return null;
}

function extractCognitiveComplexity(messages) {
  const entries = [];
  for (const msg of messages) {
    if (msg.ruleId !== "sonarjs/cognitive-complexity" || msg.severity !== 1) {
      continue;
    }
    const match = msg.message.match(/from (\d+) to the \d+ allowed/);
    if (match) {
      entries.push({ line: msg.line, value: Number(match[1]) });
    }
  }
  return entries;
}

function buildFileEntry(result) {
  const warnings = result.messages.filter((msg) => msg.severity === 1 && msg.ruleId);
  const byRule = {};
  for (const msg of warnings) {
    byRule[msg.ruleId] = (byRule[msg.ruleId] || 0) + 1;
  }
  return {
    score: warnings.length,
    byRule,
    cognitiveComplexity: extractCognitiveComplexity(result.messages),
  };
}

function main() {
  const raw = runEslint();
  const results = JSON.parse(raw);

  const files = {};
  const moduleTotals = Object.fromEntries(MODULE_CATEGORIES.map((mod) => [mod, 0]));

  for (const result of results) {
    const relPath = path
      .relative(repoRoot, result.filePath)
      .split(path.sep)
      .join("/");
    const entry = buildFileEntry(result);
    files[relPath] = entry;

    const mod = moduleForPath(relPath);
    if (mod && mod in moduleTotals) {
      moduleTotals[mod] += entry.score;
    }
  }

  const baseline = {
    generatedAt: new Date().toISOString(),
    files,
    moduleTotals,
  };

  const outPath = path.join(repoRoot, ".readability", "baseline-scores.json");
  writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
}

main();
