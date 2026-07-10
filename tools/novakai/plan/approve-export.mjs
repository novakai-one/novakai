#!/usr/bin/env node
/* =====================================================================
   approve-export.mjs — E1: single approval export
   ---------------------------------------------------------------------
   Turns an APPROVED plan into one artifact bundle:
     <out>/approved.mmd      — approved spec (base map + accepted changes)
     <out>/contracts/        — TypeScript stub/contract files per node
     <out>/plan.json         — copy of accepted changes (for novakai:status)
     <out>/CHECKLIST.md      — one-line-per-change implementer checklist

   Usage:
     node tools/novakai/plan/approve-export.mjs \
       --plan <plan.json> \
       [--map docs/novakai/_bundle.mmd] \
       --out <dir> \
       [--accepted-only]

   --accepted-only: accept only changes where verdicts[id] === 'accept'.
   A plan with NO `verdicts` map is REFUSED under this flag (exit 2) —
   nothing is provably accepted, so exporting everything would be the
   opposite of the flag's promise (AUD5/F-12). Without the flag, all
   changes are accepted. A plan whose verdicts reject EVERY change is a
   valid human decision: it exports an explicitly empty artifact
   (plan.json with 0 changes) and exits 0.

   Exit: 0 = success, 2 = bad args / IO error / verdict-less --accepted-only.

   Exports: approveExport({ baseModel, plan, outDir, acceptedOnly })
     => { mmdPath, stubCount, checklist: [{ id, status, ref, problem }] }
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMmd, toMmd } from '../../buildspec/core/mmd-parse.mjs';
import { applyPlanToSpec } from './plan-cert.mjs';
import { generate } from '../../buildspec/pipeline/spec-to-stubs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// F-12: without a verdicts map nothing is provably accepted — refusing
// beats silently exporting every change under an "accepted-only" flag.
const NO_VERDICTS_MSG =
  '--accepted-only requires a plan with a verdicts map ' +
  '(the editor decision artifact); this plan carries none';

/** Determine which changes count as "accepted" for this export. */
function resolveAcceptedFn(plan, acceptedOnly) {
  if (acceptedOnly && !plan.verdicts) {
    throw new Error(NO_VERDICTS_MSG);
  }
  return acceptedOnly ? (id) => plan.verdicts[id] === 'accept' : () => true;
}

/** Write approved.mmd + generate TypeScript stubs from the approved spec. */
function writeApprovedSpec(outDir, approvedModel) {
  const mmdPath = join(outDir, 'approved.mmd');
  writeFileSync(mmdPath, toMmd(approvedModel));
  const contractsDir = join(outDir, 'contracts');
  const genResult = generate(mmdPath, contractsDir, true);
  return { mmdPath, stubCount: genResult.files.length };
}

/** Write plan.json copy (accepted changes only, so novakai:status tracks them). */
function writePlanCopy(outDir, plan, acceptedChanges) {
  const planCopy = {
    base: plan.base ?? null,
    changes: acceptedChanges,
    ...(plan.phases ? { phases: plan.phases } : {}),
  };
  writeFileSync(join(outDir, 'plan.json'), JSON.stringify(planCopy, null, 2));
}

/** Build checklist entries (one per node/edge change). */
function buildChecklist(acceptedChanges) {
  return acceptedChanges
    .filter((change) => change.target?.kind === 'node' || change.target?.kind === 'edge')
    .map((change) => ({
      id: change.id,
      status: change.status,        // 'add' | 'modify' | 'remove'
      ref: change.target?.ref ?? '',
      problem: change.intent?.problem ?? null,
    }));
}

/** Write CHECKLIST.md — one line per accepted change. */
function writeChecklistMd(outDir, acceptedChanges, checklist) {
  const checklistLines = [
    '# Build Checklist', '',
    `Generated from ${acceptedChanges.length} accepted change(s).`,
    'Each item is "unbuilt" until the gate sees the symbol.',
    'Track progress with:', '',
    '```', `npm run novakai:status -- --plan ${outDir}/plan.json`, '```', '',
    '---', '',
  ];
  for (const item of checklist) {
    const verb = item.status.toUpperCase();
    const prob = item.problem ? `  — ${item.problem}` : '';
    checklistLines.push(`- [ ] **[${verb}]** \`${item.ref}\`${prob}`);
  }
  writeFileSync(join(outDir, 'CHECKLIST.md'), checklistLines.join('\n') + '\n');
}

/**
 * Core export logic. Pure-ish (all side effects are writes to outDir).
 *
 * @param {{ baseModel: object, plan: object, outDir: string, acceptedOnly?: boolean }} opts
 * @returns {{ mmdPath: string, stubCount: number, checklist: Array<{id,status,ref,problem}> }}
 */
export function approveExport({ baseModel, plan, outDir, acceptedOnly = false }) {
  const acceptedFn = resolveAcceptedFn(plan, acceptedOnly);
  const acceptedChanges = (plan.changes || []).filter((change) => change && change.id && acceptedFn(change.id));
  const approvedModel = applyPlanToSpec(baseModel, plan, acceptedFn);

  mkdirSync(outDir, { recursive: true });
  const { mmdPath, stubCount } = writeApprovedSpec(outDir, approvedModel);
  writePlanCopy(outDir, plan, acceptedChanges);

  const checklist = buildChecklist(acceptedChanges);
  writeChecklistMd(outDir, acceptedChanges, checklist);

  return { mmdPath, stubCount, checklist };
}

/* ---------------- CLI ---------------- */
function parseArgs() {
  const planPath = arg('--plan');
  const mapPath = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  const outDir = arg('--out');
  const acceptedOnly = process.argv.includes('--accepted-only');
  if (!planPath || !outDir) {
    console.error(
      'usage: approve-export.mjs --plan <plan.json> --out <dir> [--map <bundle.mmd>] [--accepted-only]',
    );
    process.exit(2);
  }
  return { planPath, mapPath, outDir, acceptedOnly };
}

function readPlanOrExit(planPath) {
  try {
    return JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (e) {
    console.error('cannot read plan: ' + e.message);
    process.exit(2);
  }
}

function readBaseModelOrExit(mapPath) {
  try {
    return parseMmd(readFileSync(mapPath, 'utf8'));
  } catch (e) {
    console.error('cannot read map: ' + e.message);
    process.exit(2);
  }
}

function runExportOrExit(baseModel, plan, outDir, acceptedOnly) {
  try {
    return approveExport({ baseModel, plan, outDir, acceptedOnly });
  } catch (e) {
    console.error('approve-export failed: ' + e.message);
    process.exit(2);
  }
}

function printResult(result, outDir) {
  const { mmdPath, stubCount, checklist } = result;
  console.log(`=== approve-export — E1 artifact bundle ===`);
  console.log(`  approved spec : ${mmdPath}`);
  console.log(`  stubs/contracts: ${stubCount} file(s) -> ${join(outDir, 'contracts')}`);
  console.log(`  checklist     : ${checklist.length} change(s) -> ${join(outDir, 'CHECKLIST.md')}`);
  console.log(`  plan copy     : ${join(outDir, 'plan.json')}`);
  console.log('');
  console.log(`Track build progress:  npm run novakai:status -- --plan ${join(outDir, 'plan.json')}`);
}

function main() {
  const { planPath, mapPath, outDir, acceptedOnly } = parseArgs();
  const plan = readPlanOrExit(planPath);
  const baseModel = readBaseModelOrExit(mapPath);
  const result = runExportOrExit(baseModel, plan, outDir, acceptedOnly);
  printResult(result, outDir);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
