/* Discriminating test: the lint MUST fail a human-rejected file-mirror and pass a
   human-validated real architecture map. Fixtures are committed copies so this is
   reproducible without any sibling repo. If this ever goes red the lint lost its signal. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lint } from './novakai-lint.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name) => join(here, 'fixtures', name);

let allPass = true;
function expect(name, file, wantFail) {
  const res = lint(readFileSync(fixturePath(file), 'utf8'));
  const got = res.fails.length > 0;
  const pass = got === wantFail;
  allPass = allPass && pass;
  console.log(`${pass ? '✓' : '✗'} ${name}: ${file} -> ${got ? 'FAIL' : 'PASS'} (want ${wantFail ? 'FAIL' : 'PASS'})`);
  if (!pass) console.log(`    fails=${res.fails.length} warns=${res.warns.length}`);
  if (wantFail && got) {
    console.log(`    (caught: ${res.fails.length} structural error(s), e.g. "${res.fails[0].slice(0, 60)}…")`);
  }
}
expect('human-REJECTED file-mirror must FAIL', 'bad-file-mirror.mmd', true);
expect('human-VALIDATED architecture map must PASS', 'good-reference.mmd', false);
console.log(`\n==== discriminate: ${allPass ? 'PASS' : 'FAIL'} ====`);
process.exit(allPass ? 0 : 1);
