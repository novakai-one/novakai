import { lint } from './novakai-lint.mjs';

const CODE_FLAT = 'FLAT';
const CODE_LOOSE_BAG = 'LOOSE-BAG';
const CODE_NO_SECTIONS = 'NO-SECTIONS';

let pass = 0, fail = 0;

function checkMustInclude(codes, str, label) {
  const errs = [];
  for (const code of codes) if (!str.includes(code)) errs.push(`expected ${label} '${code}' — absent`);
  return errs;
}

function checkMustExclude(codes, str, label) {
  const errs = [];
  for (const code of codes) if (str.includes(code)) errs.push(`unexpected ${label} '${code}'`);
  return errs;
}

function checkExit(result, expectExit) {
  const exit = result.fails.length ? 1 : 0;
  if (expectExit === undefined || exit === expectExit) return [];
  return [`expected exit ${expectExit}, got ${exit}`];
}

function diffErrors(result, { mustFail = [], mustWarn = [], mustNotFail = [], mustNotWarn = [], expectExit }) {
  const failStr = result.fails.join(' || ');
  const warnStr = result.warns.join(' || ');
  return [
    ...checkMustInclude(mustFail, failStr, 'FAIL'),
    ...checkMustInclude(mustWarn, warnStr, 'warn'),
    ...checkMustExclude(mustNotFail, failStr, 'FAIL'),
    ...checkMustExclude(mustNotWarn, warnStr, 'warn'),
    ...checkExit(result, expectExit),
  ];
}

function reportResult(name, errs, result) {
  if (errs.length) {
    fail++;
    console.log(`✗ ${name}`);
    for (const err of errs) console.log(`    ${err}`);
    console.log(`    (fails: ${result.fails.length}, warns: ${result.warns.length})`);
  } else {
    pass++;
    console.log(`✓ ${name}`);
  }
}

function check(name, text, opts) {
  const result = lint(text);
  reportResult(name, diffErrors(result, opts), result);
}

// T1 — spec §8 worked example VERBATIM: 5 nodes, flat, canonical-valid. MUST PASS clean.
check('T1 spec §8 worked example -> PASS clean', `flowchart TD
%% root workspace
%% fm:meta workspace name=WorkspaceArea
%% fm:meta workspace desc=root canvas surface; routes pointer events
%% fm:meta workspace i0.name=onPointer
%% fm:meta drag name=DragManager
%% fm:meta drag i0.name=start
%% fm:meta store name=Store
%% fm:meta store i0.name=patch
%% kind workspace component
%% kind drag class
%% kind isDragging function
%% kind store store
%% kind tiles component
  workspace["WorkspaceArea"]
  drag("DragManager")
  isDragging{"Dragging?"}
  store[("Store")]
  tiles(["render tiles"])
  workspace -->|routes event| drag
  drag -->|commits to| store
  drag -.->|checks| isDragging
  store -.->|rendered by| tiles`,
  { expectExit: 0, mustNotFail: [CODE_FLAT, CODE_LOOSE_BAG], mustNotWarn: ['STUB'] });

// T2 — flat file-mirror, 10 nodes, zero decomposition. MUST FAIL (FLAT).
check('T2 flat mirror 10 nodes -> FAIL FLAT', `flowchart LR
%% root a
${Array.from({length:10},(_,i)=>`%% kind n${i} module`).join('\n')}
${Array.from({length:10},(_,i)=>`  n${i}["n${i}"]`).join('\n')}
  n0 --> n1`,
  { expectExit: 1, mustFail: [CODE_FLAT] });

// T3 — correct: leaf-in-subgraph, subgraph-parented-into-unit. MUST PASS.
check('T3 decomposed+sectioned -> PASS', `flowchart LR
%% root app
%% kind app component
%% kind sec1 module
%% kind a function
%% kind b function
%% parent sec1 app
  app["App"]
  subgraph sec1 ["Phase one"]
    a("a")
    b("b")
  end
  a --> b`,
  { expectExit: 0, mustNotFail: [CODE_LOOSE_BAG, CODE_NO_SECTIONS, CODE_FLAT] });

// T4 — decomposed but bare-leaf parented, no sections. MUST FAIL (LOOSE-BAG).
check('T4 bare-leaf decomposed -> FAIL LOOSE-BAG', `flowchart LR
%% root app
%% kind app component
%% kind a function
%% kind b function
%% kind c function
%% parent a app
%% parent b app
%% parent c app
  app["App"]
  a("a")
  b("b")
  c("c")
  a --> b`,
  { expectExit: 1, mustFail: [CODE_LOOSE_BAG], mustWarn: ['BARE-LEAF'] });

// T5 — unit with exactly 1 child, no section. MUST WARN (SINGLE-CHILD), NOT FAIL.
check('T5 single-child unsectioned -> WARN not FAIL', `flowchart LR
%% root app
%% kind app component
%% kind a function
%% parent a app
  app["App"]
  a("a")`,
  { expectExit: 0, mustWarn: ['SINGLE-CHILD'], mustNotFail: [CODE_LOOSE_BAG] });

// T6 — leaves wrapped in TWO sections. MUST PASS.
check('T6 two sections -> PASS', `flowchart LR
%% root app
%% kind app component
%% kind s1 module
%% kind s2 module
%% kind a function
%% kind b function
%% parent s1 app
%% parent s2 app
  app["App"]
  subgraph s1 ["P1"]
    a("a")
  end
  subgraph s2 ["P2"]
    b("b")
  end
  a --> b`,
  { expectExit: 0, mustNotFail: [CODE_LOOSE_BAG, CODE_NO_SECTIONS] });

// T7 — REGRESSION GUARD: sectioned level, NO internal spine (NovaKai store/model shape). MUST PASS.
check('T7 sectioned + no-spine -> PASS (falsified-hypothesis guard)', `flowchart LR
%% root app
%% kind app component
%% kind s1 module
%% kind a type
%% kind b type
%% kind cc type
%% parent s1 app
  app["App"]
  subgraph s1 ["State"]
    a>"a"]
    b>"b"]
    cc>"cc"]
  end`,
  { expectExit: 0, mustNotFail: [CODE_LOOSE_BAG, CODE_NO_SECTIONS, CODE_FLAT] });

// T8 — no %% root. MUST WARN (NO-ROOT), not fail.
check('T8 no root -> WARN NO-ROOT', `flowchart LR
%% kind a function
%% kind b function
  a("a")
  b("b")
  a --> b`,
  { expectExit: 0, mustWarn: ['NO-ROOT'] });

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
