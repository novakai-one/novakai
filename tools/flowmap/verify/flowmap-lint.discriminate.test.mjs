/* Discriminating test: the lint MUST fail a human-rejected file-mirror and pass a
   human-validated real architecture map. Fixtures are committed copies so this is
   reproducible without any sibling repo. If this ever goes red the lint lost its signal. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lint } from './flowmap-lint.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const F = (n) => join(here, 'fixtures', n);

let ok = true;
function expect(name, file, wantFail) {
  const r = lint(readFileSync(F(file), 'utf8'));
  const got = r.fails.length > 0;
  const pass = got === wantFail;
  ok = ok && pass;
  console.log(`${pass ? '✓' : '✗'} ${name}: ${file} -> ${got ? 'FAIL' : 'PASS'} (want ${wantFail ? 'FAIL' : 'PASS'})`);
  if (!pass) console.log(`    fails=${r.fails.length} warns=${r.warns.length}`);
  if (wantFail && got) console.log(`    (caught: ${r.fails.length} structural error(s), e.g. "${r.fails[0].slice(0,60)}…")`);
}
expect('human-REJECTED file-mirror must FAIL', 'bad-file-mirror.mmd', true);
expect('human-VALIDATED architecture map must PASS', 'good-reference.mmd', false);
console.log(`\n==== discriminate: ${ok ? 'PASS' : 'FAIL'} ====`);
process.exit(ok ? 0 : 1);
