/* =====================================================================
   lib/transcript.mjs — M10: the ONE Claude Code transcript parser.
   ---------------------------------------------------------------------
   Both turns.mjs (MEASURE) and turn-gate.mjs (FORCE) need the identical
   answer to "what were the assistant's API calls, in order, and how many
   tool_use blocks did each one make". A session JSONL transcript RE-EMITS
   the same message.id on multiple lines — one per content block
   (thinking, text, tool_use...) — so a naive per-line count double- or
   triple-counts both API calls and tool calls. One parser, imported by
   both the measuring tool and the gate that acts on the same data, so
   they cannot drift apart on what a "turn" is.

   Dedupe rule: group lines by message.id, preserving first-seen order.
     usage    = the LAST usage object seen for that id (Claude Code
                re-stamps the same running usage on every line of a
                call; the last one is the complete one).
     tools    = every { name, input } from content blocks with
                type "tool_use", accumulated across every line carrying
                that id, in block order.

   Malformed lines (JSON.parse failure, or no type/message.id) are
   skipped and counted — never fatal. A torn line at EOF (a transcript
   still being written) must not blind the reader to every call before it.
   ===================================================================== */

/** Find or create the call record for a parsed assistant line's message id,
    tracking first-seen order in `order`. */
function getOrCreateCall(order, byId, id) {
  let call = byId.get(id);
  if (!call) {
    call = { id, usage: null, tools: [] };
    byId.set(id, call);
    order.push(call);
  }
  return call;
}

/** Merge one parsed assistant line into its call record: last-seen usage
    wins, and every tool_use content block is appended in block order. */
function mergeLineIntoCall(call, line) {
  call.usage = line.message.usage ?? call.usage; // last seen wins
  for (const block of line.message.content ?? []) {
    if (block?.type === 'tool_use') call.tools.push({ name: block.name, input: block.input });
  }
}

/** Parse one raw JSONL line into an assistant message, or null to skip it.
    `malformed` is true only for lines that fail JSON.parse — blank lines and
    non-assistant lines are silently skipped, not counted as malformed. */
function parseAssistantLine(rawLine) {
  if (!rawLine.trim()) return { parsed: null, malformed: false };
  let parsed;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return { parsed: null, malformed: true };
  }
  if (parsed?.type !== 'assistant' || !parsed?.message?.id) return { parsed: null, malformed: false };
  return { parsed, malformed: false };
}

/** Parse one transcript's raw text into deduped, ordered assistant API calls.
    Returns { calls: [{ id, usage, tools: [{name, input}] }], malformed } */
export function parseTranscript(text) {
  const order = [];
  const byId = new Map();
  let malformed = 0;
  for (const rawLine of text.split('\n')) {
    const line = parseAssistantLine(rawLine);
    if (line.malformed) malformed++;
    if (!line.parsed) continue;
    const call = getOrCreateCall(order, byId, line.parsed.message.id);
    mergeLineIntoCall(call, line.parsed);
  }
  return { calls: order, malformed };
}
