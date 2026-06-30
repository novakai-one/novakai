#!/usr/bin/env node
/* =====================================================================
   approve-export.mjs — E1: single approval export
   ---------------------------------------------------------------------
   Turns an APPROVED plan into one artifact bundle:
     <out>/approved.mmd      — approved spec (base map + accepted changes)
     <out>/contracts/        — TypeScript stub/contract files per node
     <out>/plan.json         — copy of accepted changes (for flowmap:status)
     <out>/CHECKLIST.md      — one-line-per-change implementer checklist

   Usage:
     node tools/flowmap/approve-export.mjs \
       --plan <plan.json> \
       [--map docs/flowmap/_bundle.mmd] \
       --out <dir> \
       [--accepted-only]

   --accepted-only: if the plan carries a `verdicts` map, accept only
   changes where verdicts[id] === 'accept'. Otherwise all changes accepted.

   Exit: 0 = success, 2 = bad args / IO error.

   Exports: approveExport({ baseModel, plan, outDir, acceptedOnly })
     => { mmdPath, stubCount, checklist: [{ id, status, ref, problem }] }
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMmd, toMmd } from '../buildspec/mmd-parse.mjs';
import { applyPlanToSpec } from './plan-cert.mjs';
import { generate } from '../buildspec/spec-to-stubs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/**
 * Core export logic. Pure-ish (all side effects are writes to outDir).
 *
 * @param {{ baseModel: object, plan: object, outDir: string, acceptedOnly?: boolean }} opts
 * @returns {{ mmdPath: string, stubCount: number, checklist: Array<{id,status,ref,problem}> }}
 */
export function approveExport({ baseModel, plan, outDir, acceptedOnly = false }) {
  // 1. Determine the accepted set.
  const acceptedFn = (acceptedOnly && plan.verdicts)
    ? (id) => plan.verdicts[id] === 'accept'
    : () => true;

  // Filter plan.changes to the accepted subset.
  const acceptedChanges = (plan.changes || []).filter((c) => c && c.id && acceptedFn(c.id));

  // 2. Build the approved spec model.
  const approvedModel = applyPlanToSpec(baseModel, plan, acceptedFn);

  // 3. Write approved.mmd.
  mkdirSync(outDir, { recursive: true });
  const mmdPath = join(outDir, 'approved.mmd');
  writeFileSync(mmdPath, toMmd(approvedModel));

  // 4. Generate TypeScript stubs from the approved spec.
  const contractsDir = join(outDir, 'contracts');
  const genResult = generate(mmdPath, contractsDir, true);
  const stubCount = genResult.files.length;

  // 5. Write plan.json copy (accepted changes only, so flowmap:status tracks them).
  const planCopy = {
    base: plan.base ?? null,
    changes: acceptedChanges,
    ...(plan.phases ? { phases: plan.phases } : {}),
  };
  writeFileSync(join(outDir, 'plan.json'), JSON.stringify(planCopy, null, 2));

  // 6. Build checklist entries.
  const checklist = acceptedChanges
    .filter((c) => c.target?.kind === 'node' || c.target?.kind === 'edge')
    .map((c) => ({
      id: c.id,
      status: c.status,        // 'add' | 'modify' | 'remove'
      ref: c.target?.ref ?? '',
      problem: c.intent?.problem ?? null,
    }));

  // 7. Write CHECKLIST.md.
  const checklistLines = [
    '# Build Checklist',
    '',
    `Generated from ${acceptedChanges.length} accepted change(s).`,
    'Each item is "unbuilt" until the gate sees the symbol.',
    'Track progress with:',
    '',
    '```',
    `npm run flowmap:status -- --plan ${outDir}/plan.json`,
    '```',
    '',
    '---',
    '',
  ];
  for (const item of checklist) {
    const verb = item.status.toUpperCase();
    const prob = item.problem ? `  — ${item.problem}` : '';
    checklistLines.push(`- [ ] **[${verb}]** \`${item.ref}\`${prob}`);
  }
  writeFileSync(join(outDir, 'CHECKLIST.md'), checklistLines.join('\n') + '\n');

  return { mmdPath, stubCount, checklist };
}

/* ---------------- CLI ---------------- */
function main() {
  const planPath = arg('--plan');
  const mapPath = arg('--map', join(ROOT, 'docs', 'flowmap', '_bundle.mmd'));
  const outDir = arg('--out');
  const acceptedOnly = process.argv.includes('--accepted-only');

  if (!planPath || !outDir) {
    console.error(
      'usage: approve-export.mjs --plan <plan.json> --out <dir> [--map <bundle.mmd>] [--accepted-only]',
    );
    process.exit(2);
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (e) {
    console.error('cannot read plan: ' + e.message);
    process.exit(2);
  }

  let baseModel;
  try {
    baseModel = parseMmd(readFileSync(mapPath, 'utf8'));
  } catch (e) {
    console.error('cannot read map: ' + e.message);
    process.exit(2);
  }

  let result;
  try {
    result = approveExport({ baseModel, plan, outDir, acceptedOnly });
  } catch (e) {
    console.error('approve-export failed: ' + e.message);
    process.exit(2);
  }

  const { mmdPath, stubCount, checklist } = result;
  console.log(`=== approve-export — E1 artifact bundle ===`);
  console.log(`  approved spec : ${mmdPath}`);
  console.log(`  stubs/contracts: ${stubCount} file(s) -> ${join(outDir, 'contracts')}`);
  console.log(`  checklist     : ${checklist.length} change(s) -> ${join(outDir, 'CHECKLIST.md')}`);
  console.log(`  plan copy     : ${join(outDir, 'plan.json')}`);
  console.log('');
  console.log(`Track build progress:  npm run flowmap:status -- --plan ${join(outDir, 'plan.json')}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
