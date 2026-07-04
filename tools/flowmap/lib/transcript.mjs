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

/** Parse one transcript's raw text into deduped, ordered assistant API calls.
    Returns { calls: [{ id, usage, tools: [{name, input}] }], malformed } */
export function parseTranscript(text) {
  const order = [];
  const byId = new Map();
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { malformed++; continue; }
    if (o?.type !== 'assistant' || !o?.message?.id) continue;
    const id = o.message.id;
    let call = byId.get(id);
    if (!call) {
      call = { id, usage: null, tools: [] };
      byId.set(id, call);
      order.push(call);
    }
    call.usage = o.message.usage ?? call.usage; // last seen wins
    for (const block of o.message.content ?? []) {
      if (block?.type === 'tool_use') call.tools.push({ name: block.name, input: block.input });
    }
  }
  return { calls: order, malformed };
}
