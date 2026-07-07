/* =====================================================================
   agents-stream.ts — pure cores for the Agents chat surface
   ---------------------------------------------------------------------
   Three pure, contract-tested functions kept out of the view layer:
   mdTokens (markdown-lite tokenizer), revealStep (calm reveal pacing),
   eventLabel (faint tool-activity line). No DOM, no imports from other
   app modules — see docs/novakai/plans/k6-agents.plan.json
   (k6-ui-stream / -pace / -label).
   ===================================================================== */

type MdPart = { t: 'text' | 'b' | 'code'; v: string };
type MdToken = { t: 'p'; parts: MdPart[] } | { t: 'codeblock'; lang: string; v: string };

// ---------------------------------------------------------------------
// mdTokens — blank-line-split paragraphs of {text,b,code} parts, plus
// fenced ```lang\n...\n``` code blocks kept as their own token.
// ---------------------------------------------------------------------
export function mdTokens(md: string): MdToken[] {
  const tokens: MdToken[] = [];
  const lines = md.split('\n');
  let i = 0;
  let para: string[] = [];

  function flushPara(): void {
    const text = para.join('\n');
    para = [];
    if (text.length === 0) return;
    tokens.push({ t: 'p', parts: mdInline(text) });
  }

  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\S*)/.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      // i now points at the closing fence (or past the end if unclosed)
      tokens.push({ t: 'codeblock', lang, v: body.join('\n') });
      i++;
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return tokens;
}

// Inline scan for **bold** and `code` spans within one paragraph's text.
function mdInline(text: string): MdPart[] {
  const parts: MdPart[] = [];
  let buf = '';
  let i = 0;

  function flushText(): void {
    if (buf.length > 0) parts.push({ t: 'text', v: buf });
    buf = '';
  }

  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flushText();
        parts.push({ t: 'b', v: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    } else if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flushText();
        parts.push({ t: 'code', v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flushText();
  return parts;
}

// ---------------------------------------------------------------------
// revealStep — how many buffered chars to reveal this frame.
// rate scales with backlog so replies never lag minutes behind, but
// stays at a calm 60 cps base when the buffer is small.
// ---------------------------------------------------------------------
export function revealStep(pending: number, elapsedMs: number): number {
  const rate = Math.min(2000, Math.max(60, 60 + pending * 2));
  return Math.min(pending, Math.ceil((elapsedMs * rate) / 1000));
}

// ---------------------------------------------------------------------
// eventLabel — one faint human line for a tool_use block, or null to
// stay silent. Explicit mapping table; silence is the default.
// ---------------------------------------------------------------------
export function eventLabel(tool: { name: string; input?: Record<string, unknown> }): string | null {
  const input = tool.input ?? {};
  if (tool.name === 'Edit' || tool.name === 'Write') {
    return `editing ${String(input.file_path ?? '')}`;
  }
  if (tool.name === 'Read') {
    return `reading ${String(input.file_path ?? '')}`;
  }
  if (tool.name === 'Bash') {
    const description = typeof input.description === 'string' ? input.description : 'running a command';
    return description.toLowerCase();
  }
  return null;
}
