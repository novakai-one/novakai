#!/usr/bin/env node
/* =====================================================================
   spec-to-stubs.mjs — PIPELINE STEP #1 (the engine)
   ---------------------------------------------------------------------
   Read a Novakai .mmd spec and emit TypeScript: one file per node with
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
   - Each file carries `// @novakai-node <id> kind=<kind> [parent=<p>]`,
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
const isIdent = (value) => typeof value === 'string' && /^[A-Za-z_$][\w$]*$/.test(value);

/** Remove // and /* *\/ comments so usage scans ignore JSDoc/banners. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Subset of `candidates` actually referenced in real (non-comment) code. */
function usedTypeNames(code, candidates) {
  const bare = stripComments(code);
  return candidates.filter((name) => new RegExp(`\\b${name}\\b`).test(bare)).sort();
}

function coerceType(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { tsType: 'unknown', prose: null };
  return isCleanType(trimmed)
    ? { tsType: trimmed, prose: null }
    : { tsType: 'unknown', prose: trimmed };
}

function coerceReturn(returns) {
  const arr = (returns || []).map((raw) => raw.trim()).filter(Boolean);
  if (!arr.length) return { tsType: 'void', prose: null };
  if (arr.every((x) => x === 'void')) return { tsType: 'void', prose: null };
  if (arr.length === 1) {
    return isCleanType(arr[0]) ? { tsType: arr[0], prose: null } : { tsType: 'unknown', prose: arr[0] };
  }
  return { tsType: 'unknown', prose: arr.join('; ') };
}

/** Build `(a: T, b: U)` and collect prose @param notes. */
function paramSignature(accepts) {
  const params = ifaceParams(accepts);
  const notes = [];
  const parts = params.map((param, i) => {
    const argName = '_' + (param.name || `arg${i}`);
    const { tsType, prose } = coerceType(param.type);
    if (prose) notes.push(`@param ${param.name || `arg${i}`} ${prose}`);
    return `${argName}: ${tsType}`;
  });
  return { text: parts.join(', '), notes };
}

function jsdoc(lines) {
  const body = lines.filter(Boolean);
  if (!body.length) return '';
  if (body.length === 1) return `/** ${body[0]} */\n`;
  return `/**\n${body.map((line) => ` * ${line}`).join('\n')}\n */\n`;
}

/** Distinct clean app-type names referenced by a node's fm. */
function referencedTypes(frontMatter) {
  const out = new Set();
  const eat = (raw) => {
    if (!isCleanType(raw)) return;
    for (const typeName of appTypeNames(raw)) out.add(typeName);
  };
  for (const stateEntry of frontMatter.state || []) eat(parseParamPiece(stateEntry).type);
  for (const iface of frontMatter.interfaces || []) {
    for (const accept of iface.accepts || []) {
      for (const piece of splitTopLevel(accept, ',')) eat(parseParamPiece(piece).type);
    }
    for (const ret of iface.returns || []) eat(ret);
  }
  return out;
}

function emitTypeConstruct(name, banner, head, frontMatter) {
  let body = '';
  for (const stateEntry of frontMatter.state || []) {
    const { name: fieldName, type } = parseParamPiece(stateEntry);
    const { tsType, prose } = coerceType(type);
    if (isIdent(fieldName)) body += `  ${prose ? jsdoc([prose]).replace(/\n/g, '\n  ') : ''}${fieldName}: ${tsType};\n`;
    else body += `  // field: ${stateEntry}\n`;
  }
  (frontMatter.interfaces || []).forEach((iface) => {
    if (!isIdent(iface.name)) return;
    const { text, notes } = paramSignature(iface.accepts);
    const ret = coerceReturn(iface.returns);
    const doc = jsdoc(notes.concat(ret.prose ? [`@returns ${ret.prose}`] : []));
    const prefix = doc ? '  ' + doc.replace(/\n/g, '\n  ').trimEnd() + '\n' : '';
    body += prefix + `  ${iface.name}(${text}): ${ret.tsType};\n`;
  });
  return banner + head + `export interface ${name} {\n${body}}\n`;
}

function emitClassConstruct(name, banner, head, frontMatter) {
  let fields = '';
  for (const stateEntry of frontMatter.state || []) {
    const { name: fieldName, type } = parseParamPiece(stateEntry);
    const { tsType, prose } = coerceType(type);
    if (isIdent(fieldName)) fields += `  ${fieldName}!: ${tsType};${prose ? ` // ${prose}` : ''}\n`;
    else fields += `  // state: ${stateEntry}\n`;
  }
  let methods = '';
  (frontMatter.interfaces || []).forEach((iface) => {
    if (!isIdent(iface.name)) return;
    const { text, notes } = paramSignature(iface.accepts);
    const ret = coerceReturn(iface.returns);
    const doc = jsdoc(notes.concat(ret.prose ? [`@returns ${ret.prose}`] : []));
    methods += (doc ? '  ' + doc.replace(/\n/g, '\n  ').trimEnd() + '\n' : '')
      + `  ${iface.name}(${text}): ${ret.tsType} {\n    throw new Error('unimplemented');\n  }\n`;
  });
  return banner + head + `export class ${name} {\n${fields}${fields && methods ? '\n' : ''}${methods}}\n`;
}

function emitFnStub(frontMatter, seen, iface) {
  let uniqueName = iface.name;
  while (seen.has(uniqueName)) uniqueName += '_';
  seen.add(uniqueName);
  const { text, notes } = paramSignature(iface.accepts);
  const ret = coerceReturn(iface.returns);
  const doc = jsdoc([frontMatter.description].concat(notes, ret.prose ? [`@returns ${ret.prose}`] : []));
  return doc + `export function ${uniqueName}(${text}): ${ret.tsType} {\n  throw new Error('unimplemented');\n}\n`;
}

function emitFunctionConstruct(name, banner, frontMatter) {
  const named = (frontMatter.interfaces || []).filter((i) => isIdent(i.name));
  const seen = new Set();
  if (!named.length) {
    const firstIface = (frontMatter.interfaces || [])[0] || { accepts: [], returns: [] };
    return banner + emitFnStub(frontMatter, seen, { ...firstIface, name });
  }
  return banner + named.map((i) => emitFnStub(frontMatter, seen, i)).join('\n');
}

function emitComponentConstruct(name, banner, frontMatter) {
  const ifaceDoc = (frontMatter.interfaces || [])
    .filter((i) => isIdent(i.name))
    .map((i) => `@see ${i.name}(${ifaceParams(i.accepts).length})`);
  const doc = jsdoc([frontMatter.description].concat(ifaceDoc));
  const stub = `export function ${name}(_props?: unknown): unknown {\n  throw new Error('unimplemented');\n}\n`;
  return banner + doc + stub;
}

function emitStoreConstruct(name, banner, frontMatter) {
  const doc = jsdoc([frontMatter.description, 'store hook — shape it as your state library requires']);
  return banner + doc + `export function ${name}(): unknown {\n  throw new Error('unimplemented');\n}\n`;
}

function emitModuleFnStub(seen, iface) {
  let uniqueName = iface.name;
  while (seen.has(uniqueName)) uniqueName += '_';
  seen.add(uniqueName);
  const { text, notes } = paramSignature(iface.accepts);
  const ret = coerceReturn(iface.returns);
  const doc = jsdoc(notes.concat(ret.prose ? [`@returns ${ret.prose}`] : []));
  return doc + `export function ${uniqueName}(${text}): ${ret.tsType} {\n  throw new Error('unimplemented');\n}\n`;
}

function emitModuleConstruct(name, banner, frontMatter) {
  const named = (frontMatter.interfaces || []).filter((i) => isIdent(i.name));
  if (!named.length) {
    return banner + jsdoc([frontMatter.description, 'data table / namespace — fill with the real exports'])
      + `export const ${name}: unknown = undefined;\n`;
  }
  const seen = new Set();
  const stubs = named.map((iface) => emitModuleFnStub(seen, iface));
  return banner + jsdoc([frontMatter.description]) + stubs.join('\n');
}

function emitBoundaryConstruct(kind, name, banner, frontMatter) {
  const kindNote = kind === 'service' ? 'external system boundary' : 'event / message payload';
  const doc = jsdoc([frontMatter.description, kindNote]);
  return banner + doc + `export type ${name} = unknown;\n`;
}

function emitConstruct(id, node, frontMatter, gParent) {
  const kind = node.kind;
  const name = isIdent(frontMatter.name) ? frontMatter.name : id;
  const banner = `// @novakai-node ${id} kind=${kind}${gParent ? ` parent=${gParent}` : ''}\n`;
  const head = jsdoc([frontMatter.description]);

  if (kind === 'type') return emitTypeConstruct(name, banner, head, frontMatter);
  if (kind === 'class') return emitClassConstruct(name, banner, head, frontMatter);
  if (kind === 'function' || kind === 'hook') return emitFunctionConstruct(name, banner, frontMatter);
  if (kind === 'component') return emitComponentConstruct(name, banner, frontMatter);
  if (kind === 'store') return emitStoreConstruct(name, banner, frontMatter);
  if (kind === 'module') return emitModuleConstruct(name, banner, frontMatter);
  return emitBoundaryConstruct(kind, name, banner, frontMatter);
}

function emitClassContract(id, name, banner, namedIfaces) {
  let asserts = `export type _ctor_${name} = ${name};\n`;
  for (const iface of namedIfaces) {
    asserts += `export type _p_${iface.name} = Parameters<${name}['${iface.name}']>;\n`;
    asserts += `export type _r_${iface.name} = ReturnType<${name}['${iface.name}']>;\n`;
  }
  return banner + `import type { ${name} } from './${id}';\n${asserts}`;
}

function emitFunctionContract(id, name, banner, namedIfaces) {
  const fns = namedIfaces.length ? namedIfaces.map((i) => i.name) : [name];
  const uniq = [...new Set(fns)];
  let body = `import { ${uniq.join(', ')} } from './${id}';\n`;
  for (const fnName of uniq) {
    body += `export type _p_${fnName} = Parameters<typeof ${fnName}>;\n`;
    body += `export type _r_${fnName} = ReturnType<typeof ${fnName}>;\n`;
  }
  return banner + body;
}

function emitContract(id, node, frontMatter) {
  const kind = node.kind;
  if (!MEMBER_GATED.has(kind)) return null;
  const name = isIdent(frontMatter.name) ? frontMatter.name : id;
  const namedIfaces = (frontMatter.interfaces || []).filter((i) => isIdent(i.name));
  const banner = `// @novakai-contract ${id} kind=${kind}\n`
    + `// Compile-time contract. Drift in a member name / arity / return breaks typecheck.\n`
    + `// TODO(Idea A): add executable behavioral assertions under a test runner.\n`;

  if (kind === 'type') {
    return banner + `import type { ${name} } from './${id}';\nexport type _keys_${name} = keyof ${name};\n`;
  }
  if (kind === 'class') return emitClassContract(id, name, banner, namedIfaces);
  return emitFunctionContract(id, name, banner, namedIfaces);
}

function buildTypeProvider(model, real) {
  const provider = {};
  for (const id of real) {
    if (model.nodes[id].kind !== 'type') continue;
    const typeName = model.fm[id]?.name;
    if (isIdent(typeName)) provider[typeName] = id;
  }
  return provider;
}

function collectReferencedTypes(model, real) {
  const referenced = new Set();
  for (const id of real) {
    for (const typeName of referencedTypes(model.fm[id] || {})) referenced.add(typeName);
  }
  return referenced;
}

function writeTypeBarrel(outDir, provider, referenced) {
  let barrel = '// AUTO-GENERATED by spec-to-stubs.mjs. Do not edit by hand.\n'
    + '// Placeholder types for spec type-references not defined as a `type` node.\n'
    + '// Replace `unknown` with the real type, or model it as a type node.\n';
  const placeholders = [];
  for (const typeName of [...referenced].sort()) {
    if (provider[typeName]) barrel += `export type { ${typeName} } from './${provider[typeName]}';\n`;
    else placeholders.push(typeName);
  }
  for (const typeName of placeholders) barrel += `export type ${typeName} = unknown;\n`;
  writeFileSync(join(outDir, '__types.generated.ts'), barrel);
}

function writeContractFile(id, node, frontMatter, outDir) {
  const contract = emitContract(id, node, frontMatter);
  if (!contract) return [];
  writeFileSync(join(outDir, `${id}.contract.ts`), contract);
  return [`${id}.contract.ts`];
}

function writeNodeFile(model, id, outDir) {
  const node = model.nodes[id];
  const frontMatter = model.fm[id] || { name: '', description: '', state: [], interfaces: [] };
  const name = isIdent(frontMatter.name) ? frontMatter.name : id;

  // emit the construct, then import only the types it actually references
  // in real code (prose accepts/returns collapse to `unknown`, JSDoc is
  // comment-only) so the repo's noUnusedLocals/imports stays clean.
  const code = emitConstruct(id, node, frontMatter, gateParent(model, id));
  const needs = [...referencedTypes(frontMatter)].filter((typeName) => !(node.kind === 'type' && typeName === name));
  const used = usedTypeNames(code, needs);
  const importLine = used.length ? `import type { ${used.join(', ')} } from './__types.generated';\n\n` : '';

  writeFileSync(join(outDir, `${id}.ts`), importLine + code);
  return [`${id}.ts`, ...writeContractFile(id, node, frontMatter, outDir)];
}

function generate(specPath, outDir, clean) {
  const model = parseMmd(readFileSync(specPath, 'utf8'));
  if (clean && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const real = Object.keys(model.nodes).filter((id) => !model.nodes[id].group);

  const provider = buildTypeProvider(model, real);
  const referenced = collectReferencedTypes(model, real);
  writeTypeBarrel(outDir, provider, referenced);

  const files = ['__types.generated.ts'];
  for (const id of real) files.push(...writeNodeFile(model, id, outDir));

  return { count: real.length, files };
}

// --- CLI ---
function main() {
  const args = process.argv.slice(2);
  const spec = args.find((arg) => !arg.startsWith('--'));
  const outI = args.indexOf('--out');
  const out = outI >= 0 ? args[outI + 1] : null;
  const clean = args.includes('--clean');
  if (!spec || !out) {
    console.error('usage: spec-to-stubs.mjs <spec.mmd> --out <dir> [--clean]');
    process.exit(2);
  }
  const result = generate(spec, out, clean);
  console.log(`generated ${result.files.length} files for ${result.count} nodes -> ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { generate };
