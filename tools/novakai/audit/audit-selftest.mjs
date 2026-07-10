/* =====================================================================
   audit-selftest.mjs — the --selftest checks for audit-run.mjs, run
   against the committed __fixtures__ transcripts.
   ===================================================================== */

import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverTranscripts, listRootSessions, sessionTitle, resolveSession,
  tokensOf, toolUsesOf, toolResultsOf,
} from './audit-transcripts.mjs';
import { wrapAgent, timelineNotes } from './audit-report.mjs';
import { renderHtml } from './audit-render-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/* =====================================================================
   --selftest
   ===================================================================== */

function runToolUseAndErrorChecks(check, allEntries, root) {
  check('distinct tool_use.id count across fixture transcripts is 3 (tu_bash1, tu_read1, tu_agent1)', () => {
    const ids = new Set();
    for (const entry of allEntries) for (const id of toolUsesOf(entry.lines).keys()) ids.add(id);
    assert.strictEqual(ids.size, 3, `got ${ids.size}`);
  });

  check('is_error aggregation: 1 true, 0 false, 1 n/a (null never counted as pass)', () => {
    const results = toolResultsOf(root.lines);
    let trueCount = 0, falseCount = 0, naCount = 0;
    for (const [, result] of results) {
      if (result.isError === true) trueCount++;
      else if (result.isError === false) falseCount++;
      else naCount++;
    }
    assert.strictEqual(trueCount, 1, `true=${trueCount}`);
    assert.strictEqual(falseCount, 0, `false=${falseCount}`);
    assert.strictEqual(naCount, 1, `na=${naCount}`);
  });
}

function runTokenDedupAndForeignDirChecks(check, root, subagents) {
  check('deduped token sum for a repeated message.id equals ONE copy, not doubled', () => {
    const tok = tokensOf(root.lines);
    // msg_1(output 50) + msg_2(output 8) + msg_3(output 12) = 70; a dedup bug would double msg_1 -> 120.
    assert.strictEqual(tok.output, 70, `output=${tok.output}`);
  });

  check('foreign-dir subagent transcript IS included in the discovered set '
    + '(sessionId-grouping, not dir-grouping)', () => {
    assert.ok(subagents.some((sub) => sub.agentId === 'fx2'),
      'agent-fx2 (filed under foreign dir 22222222.../subagents/) missing from discovered set');
  });
}

function runFixtureDiscoveryChecks(check, fixtures, target) {
  const { root, subagents } = discoverTranscripts(fixtures, target);
  const allEntries = [root, ...subagents];
  runToolUseAndErrorChecks(check, allEntries, root);
  runTokenDedupAndForeignDirChecks(check, root, subagents);
  return { root, subagents };
}

function runResolveSessionBasicChecks(check, fakeSessions) {
  check('resolveSession: in-range row index resolves', () => {
    assert.strictEqual(resolveSession('1', fakeSessions), fakeSessions[0].sessionId);
  });

  check('resolveSession: unique prefix resolves', () => {
    assert.strictEqual(resolveSession('30568351', fakeSessions), fakeSessions[0].sessionId);
  });

  check('resolveSession: ambiguous prefix throws', () => {
    assert.throws(() => resolveSession('aabbcc', fakeSessions), /ambiguous/);
  });
}

function runResolveSessionEdgeChecks(check, fakeSessions) {
  check('resolveSession: unknown token throws', () => {
    assert.throws(() => resolveSession('zzzzzzzz', fakeSessions), /no session matches/);
  });

  check('resolveSession: out-of-range all-digit token that IS a valid id prefix resolves '
    + '(falls through, does not throw)', () => {
    assert.strictEqual(resolveSession('30568351', fakeSessions.slice()), fakeSessions[0].sessionId);
    // 99 is out of range (only 3 fake sessions) and matches no prefix -> must throw, not silently misresolve.
    assert.throws(() => resolveSession('99', fakeSessions), /no session matches/);
  });
}

function runResolveSessionChecks(check) {
  const FAKE_SESSIONS = [
    { sessionId: '30568351-aaaa-1111-2222-333344445555' },
    { sessionId: 'aabbccdd-0000-1111-2222-333344445566' },
    { sessionId: 'aabbccee-0000-1111-2222-333344445577' },
  ];
  runResolveSessionBasicChecks(check, FAKE_SESSIONS);
  runResolveSessionEdgeChecks(check, FAKE_SESSIONS);
}

function runListRootSessionsCheck(check, fixtures, target) {
  check('listRootSessions(__fixtures__): finds exactly the top-level root, title falls back to firstPrompt', () => {
    const sessions = listRootSessions(fixtures);
    assert.strictEqual(sessions.length, 1, `length=${sessions.length}`);
    assert.strictEqual(sessions[0].sessionId, target);
    assert.strictEqual(sessionTitle(sessions[0]), 'start');
  });
}

// A minimal-but-complete report stub for the two render-facing checks below.
function buildSelftestStub(target, agents) {
  return {
    session: target, gitBranch: null, timeRange: { min: null, max: null }, rootModel: agents.rootAgent.model,
    completeness: 'selftest', notes: [], depth: 1,
    rootAgent: agents.rootAgent, subAgents: agents.subAgents, allAgents: agents.allAgents, timeline: agents.timeline,
    known: { scriptKeys: [], mjsPaths: [] }, toolRuns: [], notInvoked: [], mmdRouting: [],
    tokensTable: [],
    combined: { agent: 'combined', input: 0, output: 0, cacheCreation: 0, cacheRead: 0, bill: 0, messages: 0 },
    zeroOutputAgents: [], isErrorByAgent: [], isErrorTrueTotal: 0, isErrorFalseTotal: 0, isErrorNA: 0,
    selfMutation: [], manifest: null,
  };
}

// Real Map-backed agents, for the two checks below.
function buildFixtureAgents(root, subagents) {
  const rootAgent = wrapAgent(root, 'lead');
  const subAgents = subagents.map((sub, index) => wrapAgent(sub, 'sub' + index));
  const allAgents = [rootAgent, ...subAgents];
  const timeline = allAgents
    .flatMap((agent) => agent.events.map((event) => ({ agent: agent.label, event })))
    .sort((first, second) => (first.event.timestamp < second.event.timestamp
      ? -1
      : first.event.timestamp > second.event.timestamp ? 1 : 0));
  return { rootAgent, subAgents, allAgents, timeline };
}

function runTimelineNotesCheck(check, rootAgent, rStub) {
  check('timelineNotes extracts the exit-non-zero note for the fixture Bash tool_use (exercises Map .get())', () => {
    const event = rootAgent.events.find((evt) => evt.type === 'assistant' && Array.isArray(evt.message?.content)
      && evt.message.content.some((block) => block?.type === 'tool_use' && block.name === 'Bash'
        && block.id === 'tu_bash1'));
    assert.ok(event, 'fixture assistant event carrying tu_bash1 not found');
    const notes = timelineNotes('lead', event, rStub);
    assert.ok(notes.includes('Bash block exit non-zero: false; true'), `got ${JSON.stringify(notes)}`);
  });
}

function runRenderHtmlSmokeCheck(check, rStub, target) {
  check('renderHtml(r) smoke test: contains the session id, a <table, and the fail badge', () => {
    const html = renderHtml(rStub);
    assert.ok(typeof html === 'string' && html.length > 0);
    assert.ok(html.includes(target), 'missing session id');
    assert.ok(html.includes('<table'), 'missing <table');
    assert.ok(html.includes('fail-badge'), 'missing fail-badge marker');
  });
}

function runRenderChecks(check, root, subagents, target) {
  const agents = buildFixtureAgents(root, subagents);
  const rStub = buildSelftestStub(target, agents);
  runTimelineNotesCheck(check, agents.rootAgent, rStub);
  runRenderHtmlSmokeCheck(check, rStub, target);
}

function runSelftest() {
  const FIXTURES = join(HERE, '__fixtures__');
  const TARGET = '11111111-1111-1111-1111-111111111111';
  let failures = 0;

  function check(name, testFn) {
    try {
      testFn();
      console.log(`PASS: ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL: ${name} — ${err.message}`);
    }
  }

  const { root, subagents } = runFixtureDiscoveryChecks(check, FIXTURES, TARGET);
  runResolveSessionChecks(check);
  runListRootSessionsCheck(check, FIXTURES, TARGET);
  runRenderChecks(check, root, subagents, TARGET);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

export { runSelftest };
