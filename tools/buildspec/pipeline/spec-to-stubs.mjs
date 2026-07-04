#!/usr/bin/env node
/* =====================================================================
   spec-to-stubs.mjs — PIPELINE STEP #1 (the engine)
   ---------------------------------------------------------------------
   Read a Flowmap .mmd spec and emit TypeScript: one file per node with
   the exact signatures the fm:meta declares, bodies thrown as
   `unimplemented`. Claude Code fills bodies, never signatures. Interface
   drift becomes a `tsc` error, for free, forever.

   Also emits one compile-time CONTRACT stub per member-gated node
   (class / function / hook / type): a `.contract.ts` that references the
   symbol's signature so a rename / arity change / removed method fails
   typecheck. (TODO Idea A: upgrade these to executable behavioral tests.)

   Usage:
     node spec-to-stubs.mjs <spec.mmd> --out <dir> [--clean]

   Design decisions (see HANDOVER_buildspec_pipeline.md):
   - kind 'type'  -> interface;  'class' -> class with thrown methods;
     'function'/'hook' -> exported function(s); 'component'/'store'/
     'module'/'service'/'event' -> a best-fit stub (NOT signature-gated).
   - fm types that are valid TS are emitted verbatim; prose types become
     `unknown` with the original kept in JSDoc. Recurring clean type names
     resolve through a generated barrel (__types.generated.ts).
   - Stub params are `_`-prefixed so the repo's noUnusedParameters passes;
     drop the underscore when you implement the body.
   - Each file carries `// @flowmap-node <id> kind=<kind> [parent=<p>]`,
     the authoritative identity tag the extractor (#2) reads back.
   ===================================================================== */

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseMmd } from '../core/mmd-parse.mjs';
import { gateParent } from '../core/skeleton.mjs';
import {
  isCleanType, appTypeNames, ifaceParams, returnsValue, splitTopLevel, parseParamPiece,
} from '../core/skeleton.mjs';

const MEMBER_GATED = new Set(['class', 'function', 'hook', 'type']);
const isIdent = (s) => typeof s === 'string' && /^[A-Za-z_$][\w$]*$/.test(s);

/** Remove // and /* *\/ comments so usage scans ignore JSDoc/banners. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Subset of `candidates` actually referenced in real (non-comment) code. */
function usedTypeNames(code, candidates) {
  const bare = stripComments(code);
  return candidates.filter((t) => new RegExp(`\\b${t}\\b`).test(bare)).sort();
}

function coerceType(raw) {
  const s = (raw || '').trim();
  if (!s) return { t: 'unknown', prose: null };
  return isCleanType(s) ? { t: s, prose: null } : { t: 'unknown', prose: s };
}

function coerceReturn(returns) {
  const arr = (returns || []).map((r) => r.trim()).filter(Boolean);
  if (!arr.length) return { t: 'void', prose: null };
  if (arr.every((x) => x === 'void')) return { t: 'void', prose: null };
  if (arr.length === 1) {
    return isCleanType(arr[0]) ? { t: arr[0], prose: null } : { t: 'unknown', prose: arr[0] };
  }
  return { t: 'unknown', prose: arr.join('; ') };
}

/** Build `(a: T, b: U)` and collect prose @param notes. */
function paramSignature(accepts) {
  const params = ifaceParams(accepts);
  const notes = [];
  const parts = params.map((p, i) => {
    const nm = '_' + (p.name || `arg${i}`);
    const { t, prose } = coerceType(p.type);
    if (prose) notes.push(`@param ${p.name || `arg${i}`} ${prose}`);
    return `${nm}: ${t}`;
  });
  return { text: parts.join(', '), notes };
}

function jsdoc(lines) {
  const body = lines.filter(Boolean);
  if (!body.length) return '';
  if (body.length === 1) return `/** ${body[0]} */\n`;
  return `/**\n${body.map((l) => ` * ${l}`).join('\n')}\n */\n`;
}

/** Distinct clean app-type names referenced by a node's fm. */
function referencedTypes(fm) {
  const out = new Set();
  const eat = (raw) => { if (isCleanType(raw)) for (const n of appTypeNames(raw)) out.add(n); };
  for (const s of fm.state || []) eat(parseParamPiece(s).type);
  for (const iface of fm.interfaces || []) {
    for (const a of iface.accepts || []) for (const piece of splitTopLevel(a, ',')) eat(parseParamPiece(piece).type);
    for (const r of iface.returns || []) eat(r);
  }
  return out;
}

function emitConstruct(id, node, fm, gParent) {
  const kind = node.kind;
  const name = isIdent(fm.name) ? fm.name : id;
  const banner = `// @flowmap-node ${id} kind=${kind}${gParent ? ` parent=${gParent}` : ''}\n`;
  const head = jsdoc([fm.description]);

  // ---- interface (type) ----
  if (kind === 'type') {
    let body = '';
    for (const s of fm.state || []) {
      const { name: pn, type } = parseParamPiece(s);
      const { t, prose } = coerceType(type);
      if (isIdent(pn)) body += `  ${prose ? jsdoc([prose]).replace(/\n/g, '\n  ') : ''}${pn}: ${t};\n`;
      else body += `  // field: ${s}\n`;
    }
    (fm.interfaces || []).forEach((iface) => {
      if (!isIdent(iface.name)) return;
      const { text, notes } = paramSignature(iface.accepts);
      const ret = coerceReturn(iface.returns);
      const doc = jsdoc(notes.concat(ret.prose ? [`@returns ${ret.prose}`] : []));
      body += (doc ? '  ' + doc.replace(/\n/g, '\n  ').trimEnd() + '\n' : '') + `  ${iface.name}(${text}): ${ret.t};\n`;
    });
    return banner + head + `export interface ${name} {\n${body}}\n`;
  }

  // ---- class ----
  if (kind === 'class') {
    let fields = '';
    for (const s of fm.state || []) {
      const { name: pn, type } = parseParamPiece(s);
      const { t, prose } = coerceType(type);
      if (isIdent(pn)) fields += `  ${pn}!: ${t};${prose ? ` // ${prose}` : ''}\n`;
      else fields += `  // state: ${s}\n`;
    }
    let methods = '';
    (fm.interfaces || []).forEach((iface) => {
      if (!isIdent(iface.name)) return;
      const { text, notes } = paramSignature(iface.accepts);
      const ret = coerceReturn(iface.returns);
      const doc = jsdoc(notes.concat(ret.prose ? [`@returns ${ret.prose}`] : []));
      methods += (doc ? '  ' + doc.replace(/\n/g, '\n  ').trimEnd() + '\n' : '')
        + `  ${iface.name}(${text}): ${ret.t} {\n    throw new Error('unimplemented');\n  }\n`;
    });
    return banner + head + `export class ${name} {\n${fields}${fields && methods ? '\n' : ''}${methods}}\n`;
  }

  // ---- function group (function / hook) ----
  if (kind === 'function' || kind === 'hook') {
    const named = (fm.interfaces || []).filter((i) => isIdent(i.name));
    const seen = new Set();
    const emitFn = (fnName, accepts, returns) => {
      let fn = fnName; while (seen.has(fn)) fn += '_'; seen.add(fn);
      const { text, notes } = paramSignature(accepts);
      const ret = coerceReturn(returns);
      const doc = jsdoc([fm.description].concat(notes, ret.prose ? [`@returns ${ret.prose}`] : []));
      return doc + `export function ${fn}(${text}): ${ret.t} {\n  throw new Error('unimplemented');\n}\n`;
    };
    if (!named.length) {
      const i0 = (fm.interfaces || [])[0] || { accepts: [], returns: [] };
      return banner + emitFn(name, i0.accepts, i0.returns);
    }
    return banner + named.map((i) => emitFn(i.name, i.accepts, i.returns)).join('\n');
  }

  // ---- component ----
  if (kind === 'component') {
    const ifaceDoc = (fm.interfaces || [])
      .filter((i) => isIdent(i.name))
      .map((i) => `@see ${i.name}(${ifaceParams(i.accepts).length})`);
    const doc = jsdoc([fm.description].concat(ifaceDoc));
    return banner + doc + `export function ${name}(_props?: unknown): unknown {\n  throw new Error('unimplemented');\n}\n`;
  }

  // ---- store (zustand hook) ----
  if (kind === 'store') {
    const doc = jsdoc([fm.description, 'store hook — shape it as your state library requires']);
    return banner + doc + `export function ${name}(): unknown {\n  throw new Error('unimplemented');\n}\n`;
  }

  // ---- module: emit any named helpers, else a placeholder export ----
  if (kind === 'module') {
    const named = (fm.interfaces || []).filter((i) => isIdent(i.name));
    if (named.length) {
      const seen = new Set();
      return banner + jsdoc([fm.description]) + named.map((iface) => {
        let fn = iface.name; while (seen.has(fn)) fn += '_'; seen.add(fn);
        const { text, notes } = paramSignature(iface.accepts);
        const ret = coerceReturn(iface.returns);
        const doc = jsdoc(notes.concat(ret.prose ? [`@returns ${ret.prose}`] : []));
        return doc + `export function ${fn}(${text}): ${ret.t} {\n  throw new Error('unimplemented');\n}\n`;
      }).join('\n');
    }
    return banner + jsdoc([fm.description, 'data table / namespace — fill with the real exports'])
      + `export const ${name}: unknown = undefined;\n`;
  }

  // ---- service / event: external boundary or message type ----
  const doc = jsdoc([fm.description, kind === 'service' ? 'external system boundary' : 'event / message payload']);
  return banner + doc + `export type ${name} = unknown;\n`;
}

function emitContract(id, node, fm) {
  const kind = node.kind;
  if (!MEMBER_GATED.has(kind)) return null;
  const name = isIdent(fm.name) ? fm.name : id;
  const namedIfaces = (fm.interfaces || []).filter((i) => isIdent(i.name));
  const banner = `// @flowmap-contract ${id} kind=${kind}\n`
    + `// Compile-time contract. Drift in a member name / arity / return breaks typecheck.\n`
    + `// TODO(Idea A): add executable behavioral assertions under a test runner.\n`;

  if (kind === 'type') {
    return banner + `import type { ${name} } from './${id}';\nexport type _keys_${name} = keyof ${name};\n`;
  }
  if (kind === 'class') {
    let asserts = `export type _ctor_${name} = ${name};\n`;
    for (const iface of namedIfaces) {
      asserts += `export type _p_${iface.name} = Parameters<${name}['${iface.name}']>;\n`;
      asserts += `export type _r_${iface.name} = ReturnType<${name}['${iface.name}']>;\n`;
    }
    return banner + `import type { ${name} } from './${id}';\n${asserts}`;
  }
  // function / hook -> exported functions
  const fns = namedIfaces.length ? namedIfaces.map((i) => i.name) : [name];
  const uniq = [...new Set(fns)];
  let body = `import { ${uniq.join(', ')} } from './${id}';\n`;
  for (const fn of uniq) {
    body += `export type _p_${fn} = Parameters<typeof ${fn}>;\n`;
    body += `export type _r_${fn} = ReturnType<typeof ${fn}>;\n`;
  }
  return banner + body;
}

function generate(specPath, outDir, clean) {
  const model = parseMmd(readFileSync(specPath, 'utf8'));
  if (clean && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const real = Object.keys(model.nodes).filter((id) => !model.nodes[id].group);

  // provider map: type-node Name -> id (for barrel re-export of real types)
  const provider = {};
  for (const id of real) {
    if (model.nodes[id].kind === 'type') {
      const nm = model.fm[id]?.name;
      if (isIdent(nm)) provider[nm] = id;
    }
  }

  // every clean app-type name referenced anywhere
  const referenced = new Set();
  for (const id of real) for (const n of referencedTypes(model.fm[id] || {})) referenced.add(n);

  // barrel: re-export real type nodes, placeholder the rest
  let barrel = '// AUTO-GENERATED by spec-to-stubs.mjs. Do not edit by hand.\n'
    + '// Placeholder types for spec type-references not defined as a `type` node.\n'
    + '// Replace `unknown` with the real type, or model it as a type node.\n';
  const placeholders = [];
  for (const t of [...referenced].sort()) {
    if (provider[t]) barrel += `export type { ${t} } from './${provider[t]}';\n`;
    else placeholders.push(t);
  }
  for (const t of placeholders) barrel += `export type ${t} = unknown;\n`;
  writeFileSync(join(outDir, '__types.generated.ts'), barrel);

  const files = ['__types.generated.ts'];
  for (const id of real) {
    const node = model.nodes[id];
    const fm = model.fm[id] || { name: '', description: '', state: [], interfaces: [] };
    const name = isIdent(fm.name) ? fm.name : id;

    // emit the construct, then import only the types it actually references
    // in real code (prose accepts/returns collapse to `unknown`, JSDoc is
    // comment-only) so the repo's noUnusedLocals/imports stays clean.
    const code = emitConstruct(id, node, fm, gateParent(model, id));
    const needs = [...referencedTypes(fm)].filter((t) => !(node.kind === 'type' && t === name));
    const used = usedTypeNames(code, needs);
    const importLine = used.length ? `import type { ${used.join(', ')} } from './__types.generated';\n\n` : '';

    writeFileSync(join(outDir, `${id}.ts`), importLine + code);
    files.push(`${id}.ts`);

    const contract = emitContract(id, node, fm);
    if (contract) { writeFileSync(join(outDir, `${id}.contract.ts`), contract); files.push(`${id}.contract.ts`); }
  }

  return { count: real.length, files };
}

// --- CLI ---
function main() {
  const args = process.argv.slice(2);
  const spec = args.find((a) => !a.startsWith('--'));
  const outI = args.indexOf('--out');
  const out = outI >= 0 ? args[outI + 1] : null;
  const clean = args.includes('--clean');
  if (!spec || !out) {
    console.error('usage: spec-to-stubs.mjs <spec.mmd> --out <dir> [--clean]');
    process.exit(2);
  }
  const r = generate(spec, out, clean);
  console.log(`generated ${r.files.length} files for ${r.count} nodes -> ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { generate };
