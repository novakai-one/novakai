/* replay.test.mjs — acceptance for the determinism harness (node #3) and the
   META-ACCEPTANCE for the whole subagent-contract idea.
   The decisive test is "catches a non-deterministic command": if replay could
   not catch a judgement leak, the 100->100 guarantee would be unfounded. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'replay.mjs');

function replay(task, n) {
  const r = spawnSync('node', [CLI, '--task', task, '--n', String(n), '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('a deterministic command -> deterministic:true, one hash, exit 0', () => {
  const r = replay('node -e "process.stdout.write(JSON.stringify({a:1,b:2}))"', 6);
  assert.equal(r.status, 0);
  assert.equal(r.report.deterministic, true);
  assert.equal(r.report.distinctOutputs, 1);
  assert.ok(r.report.hash);
});

test('CATCHES a non-deterministic command -> deterministic:false, exit 1 (the leak detector)', () => {
  const r = replay('node -e "process.stdout.write(String(Math.random()))"', 8);
  assert.equal(r.status, 1);
  assert.equal(r.report.deterministic, false);
  assert.ok(r.report.distinctOutputs > 1, 'must observe more than one distinct output');
});

test('CATCHES non-uniform exit status even when stdout is constant', () => {
  // stdout stays empty while the exit code flips 0/1 between runs via a counter
  // file. The previous fixture used the shell's $RANDOM, which dash (the /bin/sh
  // on ubuntu CI runners) does not have: the task became `exit 0` every run and
  // this test failed there while passing under macOS bash.
  const dir = mkdtempSync(join(tmpdir(), 'replay-flip-'));
  const flip = join(dir, 'n');
  const task = `node -e 'const fs=require("fs");const f="${flip}";let n=0;try{n=+fs.readFileSync(f,"utf8")}catch{}fs.writeFileSync(f,String(n+1));process.exit(n%2)'`;
  try {
    const r = replay(task, 10);
    assert.equal(r.report.deterministic, false);
    assert.equal(r.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real verdict command replays to ONE hash (100->100 on a real change)', () => {
  const r = replay('node tools/flowmap/verify-change.mjs --change frame-transform --json', 3);
  assert.equal(r.status, 0);
  assert.equal(r.report.deterministic, true);
  assert.equal(r.report.distinctOutputs, 1);
});

test('bad invocation (n < 2) is a usage error (exit 2)', () => {
  const r = replay('true', 1);
  assert.equal(r.status, 2);
});
