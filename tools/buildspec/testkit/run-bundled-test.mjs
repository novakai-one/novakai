/* run-bundled-test.mjs — bundle a .ts/.mjs test entry (resolving Vite-style
   extensionless imports) via rolldown, then execute it with node --test.
   Usage: node tools/buildspec/testkit/run-bundled-test.mjs <entry.mjs>
   Why: src/io/mermaid.ts uses extensionless imports that raw node can't
   resolve. Rolldown (vite's bundler, already installed) resolves them. */

import { rolldown } from 'rolldown';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const entry = process.argv[2];
if (!entry) {
  console.error('need entry');
  process.exit(2);
}

const bundle = await rolldown({
  input: entry,
  resolve: { extensions: ['.ts', '.mjs', '.js'] },
  // keep node built-ins + node:test external
  external: (id) => id.startsWith('node:'),
});
const { output } = await bundle.generate({ format: 'esm' });
const code = output[0].code;

const dir = mkdtempSync(join(tmpdir(), 'fmtest-'));
const out = join(dir, 'bundled.test.mjs');
writeFileSync(out, code);

const res = spawnSync(process.execPath, ['--test', out], { stdio: 'inherit' });
process.exit(res.status ?? 1);
