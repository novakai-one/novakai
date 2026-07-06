import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');

test('help exits 0 and lists all seven verbs and all loop stages', () => {
  const result = spawnSync('node', [CLI, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const out = result.stdout;
  for (const verb of ['onboard', 'plan', 'contract', 'verify', 'ship', 'status', 'help']) {
    assert.ok(out.includes(verb), `expected help output to mention verb "${verb}"`);
  }
  for (const stage of ['understand', 'plan', 'review', 'approve', 'implement', 're-sync']) {
    assert.ok(out.includes(stage), `expected help output to mention loop stage "${stage}"`);
  }
});

test('unknown verb exits 2 and does not run an npm script', () => {
  const result = spawnSync('node', [CLI, 'bogus-verb'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: novakai <onboard\|plan\|contract\|verify\|ship\|status\|help> \[args\.\.\.\]/);
});

test('no verb given exits 2', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
