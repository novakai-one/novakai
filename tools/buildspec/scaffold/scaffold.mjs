#!/usr/bin/env node
/**
 * scaffold.mjs — Flowmap scaffold tool
 *
 * Three modes:
 *   --backfill <fragment.mmd>  Read %% src directives, find real TS signatures,
 *                              inject i0.accepts/i0.returns lines with real types
 *                              for leaf nodes that lack them. Idempotent.
 *   --init                     Walk a TS project with no fragments, emit draft
 *                              fragments + root.mmd with all mechanical lines
 *                              pre-filled. Output FAILS flowmap-lint by design.
 *   --add-from-plan <plan.json> --fragment <fragment.mmd>
 *                              Append new nodes from an approved plan into a
 *                              fragment file. Idempotent — nodes already present
 *                              are skipped. Use --dry to preview without writing.
 *
 * Usage:
 *   node scaffold.mjs --backfill <fragment.mmd> --tsconfig <tsconfig.json> [--dry]
 *   node scaffold.mjs --init --tsconfig <tsconfig.json> --src <srcDir> --out <outDir> [--force] [--dry]
 *   node scaffold.mjs --add-from-plan <plan.json> --fragment <fragment.mmd> [--dry]
 */

import { Project, Node } from 'ts-morph';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative, basename, dirname } from 'path';
import { findSymbol, signatureAtBanner } from '../pipeline/extract.mjs';
import { parseMmd } from '../core/mmd-parse.mjs';

const GATED = new Set(['class', 'function', 'hook', 'type']);
const D_SRC = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;
const D_KIND = /^%%\s*kind\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;
const D_FM_META = /^%%\s*fm:meta\s+([A-Za-z0-9_]+)\s+(.*)$/;
const D_ROOT = /^%%\s*root\s+([A-Za-z0-9_]+)/;
const D_PARENT = /^%%\s*parent\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)/;

const SKIP_SUFFIXES = ['.d.ts', '.test.ts', '.contract.ts', '.spec.ts', '.generated.ts'];
const SKIP_DIRS = ['node_modules', 'contracts', 'dist', 'build'];

// ─── Helpers ──────────────────────────────────────────────────────────

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}

/** Parse a fragment file into structured data. */
function parseFragment(text) {
  const lines = text.split('\n');
  const srcMap = {};       // id → { path, symbol }
  const kindMap = {};      // id → kind
  const nameMap = {};      // id → name
  const hasInterface = new Set(); // ids that already have i<N>.name=
  const lastMetaLine = {}; // id → last line index with %% fm:meta <id>
  const lastRefLine = {};  // id → last line index with any %% reference (kind/src/meta)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    if ((m = D_SRC.exec(line))) {
      const id = m[1];
      const raw = m[2];
      const hashIdx = raw.indexOf('#');
      srcMap[id] = {
        path: hashIdx >= 0 ? raw.slice(0, hashIdx) : raw,
        symbol: hashIdx >= 0 ? raw.slice(hashIdx + 1) : id,
      };
      lastRefLine[id] = i;
    } else if ((m = D_KIND.exec(line))) {
      kindMap[m[1]] = m[2];
      lastRefLine[m[1]] = i;
    } else if ((m = D_FM_META.exec(line))) {
      const id = m[1];
      const rest = m[2];
      lastMetaLine[id] = i;
      lastRefLine[id] = i;
      if (rest.startsWith('name=')) {
        nameMap[id] = rest.slice(5).trim();
      }
      if (/^i\d+\.name=/.test(rest)) {
        hasInterface.add(id);
      }
    }
  }

  return { lines, srcMap, kindMap, nameMap, hasInterface, lastMetaLine, lastRefLine };
}

/** Generate interface lines for a node from its real TS signature. */
function interfaceLines(id, symbol, kind, decl) {
  const sig = signatureAtBanner(decl);
  const lines = [];

  // For classes, iterate methods; for functions, the signature IS the interface
  if (kind === 'class' && Node.isClassDeclaration(decl)) {
    const methods = decl.getInstanceMethods().filter(m => {
      const sc = m.getScope ? m.getScope() : 'public';
      return sc !== 'private' && sc !== 'protected';
    });
    methods.forEach((m, idx) => {
      const memSig = signatureAtBanner(m);
      lines.push(`%% fm:meta ${id} i${idx}.name=${m.getName()}`);
      for (const a of memSig.accepts) {
        lines.push(`%% fm:meta ${id} i${idx}.accepts=${a}`);
      }
      if (memSig.returns) {
        lines.push(`%% fm:meta ${id} i${idx}.returns=${memSig.returns}`);
      }
    });
    return lines;
  }

  // For interfaces/types, iterate methods
  if (kind === 'type' && Node.isInterfaceDeclaration(decl)) {
    const methods = decl.getMethods();
    methods.forEach((m, idx) => {
      const memSig = signatureAtBanner(m);
      lines.push(`%% fm:meta ${id} i${idx}.name=${m.getName()}`);
      for (const a of memSig.accepts) {
        lines.push(`%% fm:meta ${id} i${idx}.accepts=${a}`);
      }
      if (memSig.returns) {
        lines.push(`%% fm:meta ${id} i${idx}.returns=${memSig.returns}`);
      }
    });
    return lines;
  }

  // For functions/hooks: single interface entry
  lines.push(`%% fm:meta ${id} i0.name=${symbol}`);
  for (const a of sig.accepts) {
    lines.push(`%% fm:meta ${id} i0.accepts=${a}`);
  }
  if (sig.returns) {
    lines.push(`%% fm:meta ${id} i0.returns=${sig.returns}`);
  }
  return lines;
}

// ─── Backfill mode ────────────────────────────────────────────────────

function backfill(fragmentPath, project, dry) {
  const text = readFileSync(fragmentPath, 'utf8');
  const frag = parseFragment(text);
  const additions = []; // { insertAfter, lines }

  let added = 0;
  let skipped = 0;
  let notFound = 0;

  for (const id of Object.keys(frag.srcMap)) {
    // Skip if already has interface declarations
    if (frag.hasInterface.has(id)) { skipped++; continue; }

    const kind = frag.kindMap[id];
    if (!kind || !GATED.has(kind)) { skipped++; continue; }

    const { path, symbol } = frag.srcMap[id];
    const sf = project.getSourceFile(resolve(path));
    if (!sf) { notFound++; continue; }

    const decl = findSymbol(sf, symbol);
    if (!decl) { notFound++; continue; }

    const newLines = interfaceLines(id, symbol, kind, decl);
    if (newLines.length === 0) { skipped++; continue; }

    // Insertion point: after the last %% fm:meta <id> line, or after
    // the last %% reference (kind/src) line as fallback
    const insertAfter = frag.lastMetaLine[id] ?? frag.lastRefLine[id] ?? -1;
    if (insertAfter < 0) { skipped++; continue; }

    additions.push({ insertAfter, lines: newLines });
    added++;
  }

  if (dry) {
    console.log(`[dry-run] ${fragmentPath}`);
    console.log(`  would add interfaces for ${added} nodes, skip ${skipped}, not found ${notFound}`);
    for (const add of additions) {
      console.log(`  --- insert after line ${add.insertAfter + 1} ---`);
      for (const l of add.lines) console.log(`  + ${l}`);
    }
    return;
  }

  // Sort additions by insertAfter descending (bottom-to-top) so line
  // numbers don't shift during insertion
  additions.sort((a, b) => b.insertAfter - a.insertAfter);

  const outLines = [...frag.lines];
  for (const add of additions) {
    outLines.splice(add.insertAfter + 1, 0, ...add.lines);
  }

  writeFileSync(fragmentPath, outLines.join('\n'));
  console.log(`${fragmentPath}: +${additions.length} interface blocks (${added} nodes backfilled, ${skipped} skipped, ${notFound} not found)`);
}

// ─── Init mode ────────────────────────────────────────────────────────

function shouldSkipFile(filePath) {
  for (const suffix of SKIP_SUFFIXES) {
    if (filePath.endsWith(suffix)) return true;
  }
  return false;
}

function shouldSkipDir(dirPath) {
  for (const d of SKIP_DIRS) {
    if (dirPath.includes(`/${d}/`) || dirPath.endsWith(`/${d}`)) return true;
  }
  return false;
}

/** Collect exported symbols from a TS project, grouped by folder. */
function collectSymbols(project, srcDir) {
  const byFolder = {}; // relativeFolder → [{ symbol, kind, file, relPath }]

  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath().replace(/\\/g, '/');
    if (filePath.includes('node_modules')) continue;

    const relPath = relative(resolve(srcDir), filePath);
    if (relPath.startsWith('..')) continue; // outside src dir
    if (shouldSkipFile(filePath)) continue;

    const folder = dirname(relPath);
    if (shouldSkipDir(folder)) continue;

    if (!byFolder[folder]) byFolder[folder] = [];

    // Exported classes
    for (const c of sf.getClasses()) {
      if (!c.isExported() || !c.getName()) continue;
      byFolder[folder].push({
        symbol: c.getName(), kind: 'class', file: filePath, relPath,
        node: c,
      });
    }

    // Exported interfaces
    for (const i of sf.getInterfaces()) {
      if (!i.isExported() || !i.getName()) continue;
      byFolder[folder].push({
        symbol: i.getName(), kind: 'type', file: filePath, relPath,
        node: i,
      });
    }

    // Exported functions
    for (const f of sf.getFunctions()) {
      if (!f.isExported() || !f.getName()) continue;
      byFolder[folder].push({
        symbol: f.getName(), kind: 'function', file: filePath, relPath,
        node: f,
      });
    }
  }

  return byFolder;
}

/** Generate a draft fragment for a folder. */
function draftFragment(folder, symbols, srcDir) {
  const containerId = folder.split('/').pop().replace(/[^A-Za-z0-9_]/g, '_');
  const lines = [];

  lines.push('flowchart LR');
  lines.push(`%% root ${containerId}`);
  lines.push(`%% AUTO-GENERATED DRAFT — edit sections, desc, spine edges before shipping`);
  lines.push('');

  // Collect all symbols and emit metadata
  const nodeIds = [];
  for (const sym of symbols) {
    const id = sym.symbol;
    nodeIds.push({ id: sym.symbol, kind: sym.kind, label: sym.symbol });

    const relPath = relative(resolve(srcDir), sym.file);
    const srcPath = relative(process.cwd(), sym.file);

    lines.push(`%% src ${id} ${srcPath}#${sym.symbol}`);
    lines.push(`%% kind ${id} ${sym.kind}`);
    lines.push(`%% fm:meta ${id} name=${sym.symbol}`);
    lines.push(`%% fm:meta ${id} desc=`);

    // Interface lines for gated kinds
    if (GATED.has(sym.kind)) {
      const ifaceLines = interfaceLines(id, sym.symbol, sym.kind, sym.node);
      for (const l of ifaceLines) lines.push(l);
    }
    lines.push('');
  }

  // Node definitions
  for (const n of nodeIds) {
    const shape = n.kind === 'function' ? `("${n.label}")` : `["${n.label}"]`;
    lines.push(`  ${n.id}${shape}`);
  }
  lines.push('');

  // Import edges (dotted) — raw imports, informational only
  const edgeSet = new Set();
  for (const sym of symbols) {
    const sf = sym.node.getSourceFile();
    for (const imp of sf.getImportDeclarations()) {
      const resolved = imp.getModuleSpecifierSourceFile();
      if (!resolved) continue;
      const importedNames = imp.getNamedImports().map(i => i.getName());
      // Check if any imported name matches a symbol in this folder
      for (const name of importedNames) {
        if (symbols.some(s => s.symbol === name) && name !== sym.symbol) {
          const key = `${name} -.-> ${sym.symbol}`;
          edgeSet.add(key);
        }
      }
    }
  }
  for (const e of [...edgeSet].sort()) {
    lines.push(`  ${e}`);
  }

  return { containerId, content: lines.join('\n') + '\n' };
}

/** Generate a draft root.mmd from collected folders. */
function draftRoot(folders, srcDir) {
  const lines = [];
  lines.push('flowchart LR');
  lines.push('%% AUTO-GENERATED DRAFT — edit container names, desc, spine edges before shipping');
  lines.push('');

  // Container nodes — one per folder
  const containers = [];
  for (const folder of folders) {
    const id = folder.split('/').pop().replace(/[^A-Za-z0-9_]/g, '_');
    containers.push({ id, label: folder.split('/').pop() });

    // Find first source file in folder for src directive
    lines.push(`%% kind ${id} module`);
    lines.push(`%% fm:meta ${id} name=${id}`);
    lines.push(`%% fm:meta ${id} desc=`);
    lines.push('');
  }

  // Root directive — pick the most connected folder (heuristic: src/ root)
  const rootId = containers.length > 0 ? containers[0].id : 'main';
  // Replace the first line's comment with the actual root
  lines[0] = 'flowchart LR';
  lines.splice(1, 0, `%% root ${rootId}`);

  // Node definitions
  for (const c of containers) {
    lines.push(`  ${c.id}["${c.label}"]`);
  }
  lines.push('');

  // Dotted edges between containers (from import analysis)
  // This is a simplified version — real cross-folder imports
  const edgeSet = new Set();
  for (const folder of folders) {
    const folderId = folder.split('/').pop().replace(/[^A-Za-z0-9_]/g, '_');
    // Check if we have symbols in this folder that import from other folders
    // (handled per-fragment, so here we just skip — cross-folder edges are
    // better curated by hand)
  }

  return lines.join('\n') + '\n';
}

function init(srcDir, outDir, project, force, dry) {
  const byFolder = collectSymbols(project, srcDir);
  const folders = Object.keys(byFolder).filter(f => byFolder[f].length > 0).sort();

  if (folders.length === 0) {
    console.error('No exported symbols found under', srcDir);
    process.exit(1);
  }

  // Ensure outDir exists
  const outRoot = resolve(outDir);
  if (!dry && !existsSync(outRoot)) mkdirSync(outRoot, { recursive: true });

  let totalNodes = 0;

  // Write root.mmd — goes to --out directory
  const rootPath = join(outRoot, 'root.mmd');
  if (dry) {
    console.log(`[dry-run] would write: ${rootPath} (${folders.length} containers)`);
  } else if (existsSync(rootPath) && !force) {
    console.log(`SKIP (exists): ${rootPath}  (use --force to overwrite)`);
  } else {
    writeFileSync(rootPath, draftRoot(folders, srcDir));
    console.log(`WROTE: ${rootPath} (${folders.length} containers)`);
  }

  // Write one fragment per folder — also goes under --out (mirrors source
  // structure). User moves them to source folders for bundler to find.
  for (const folder of folders) {
    const symbols = byFolder[folder];
    const { containerId, content } = draftFragment(folder, symbols, srcDir);

    // Fragment goes under outDir, mirroring the source folder structure
    const fragDir = join(outRoot, folder);
    const fragPath = join(fragDir, `${containerId}.flowmap.mmd`);

    if (dry) {
      console.log(`[dry-run] would write: ${fragPath} (${symbols.length} nodes)`);
    } else if (existsSync(fragPath) && !force) {
      console.log(`SKIP (exists): ${fragPath}  (use --force to overwrite)`);
      continue;
    } else {
      if (!existsSync(fragDir)) mkdirSync(fragDir, { recursive: true });
      writeFileSync(fragPath, content);
      console.log(`WROTE: ${fragPath} (${symbols.length} nodes)`);
    }
    totalNodes += symbols.length;
  }

  console.log(`\nDone. ${folders.length} folders, ${totalNodes} nodes.`);
  if (!dry) {
    console.log('\nNext steps:');
    console.log(`  1. Move fragments from ${outRoot}/ to your source folders`);
    console.log('  2. Add prose desc= for each node');
    console.log('  3. Group nodes into purpose-named subgraphs');
    console.log('  4. Wire solid spine edges (-->)');
    console.log('  5. Curate dotted reference edges (-.->)');
    console.log('  6. Run npm run flowmap:ship until lint passes');
  }
}

// ─── Add-from-plan mode ───────────────────────────────────────────────

/**
 * Append new nodes from an approved plan into a flowmap fragment.
 * Exported for use in tests. Idempotent.
 *
 * @param {string} planPath  path to the plan JSON file
 * @param {string} fragmentPath  path to the fragment .mmd file
 * @param {boolean} dry  if true, print the lines that would be added but do not write
 */
function addFromPlan(planPath, fragmentPath, dry) {
  const planJson = JSON.parse(readFileSync(planPath, 'utf8'));
  const fragmentText = readFileSync(fragmentPath, 'utf8');

  // Collect add-node changes from the plan
  const changes = Array.isArray(planJson.changes) ? planJson.changes : [];
  const addChanges = changes.filter(
    (c) => c.status === 'add' && c.target && c.target.kind === 'node' && c.newNode,
  );

  // Detect nodes already present in the fragment using kindMap from parseFragment
  const frag = parseFragment(fragmentText);
  const existingIds = new Set(Object.keys(frag.kindMap));

  // Also check parseMmd to catch node-def lines without a %% kind directive
  const parsed = parseMmd(fragmentText);
  for (const id of Object.keys(parsed.nodes)) existingIds.add(id);

  const newChanges = addChanges.filter((c) => !existingIds.has(c.target.ref));

  if (newChanges.length === 0) {
    console.log(`${fragmentPath}: no new nodes to add`);
    return;
  }

  // Build the block of lines for each new node
  const allNewLines = [];
  for (const change of newChanges) {
    const id = change.target.ref;
    const newNode = change.newNode;
    const fm = change.fm;
    const kind = (newNode.kind) || 'module';
    const label = (fm && fm.name) || newNode.label;
    const desc = (fm && fm.description) || '';

    const block = [];
    block.push(`%% kind ${id} ${kind}`);
    block.push(`%% fm:meta ${id} name=${label}`);
    block.push(`%% fm:meta ${id} desc=${desc}`);

    if (fm && Array.isArray(fm.interfaces)) {
      fm.interfaces.forEach((iface, n) => {
        if (iface.name !== undefined) block.push(`%% fm:meta ${id} i${n}.name=${iface.name}`);
        for (const a of (iface.accepts || [])) block.push(`%% fm:meta ${id} i${n}.accepts=${a}`);
        for (const r of (iface.returns || [])) block.push(`%% fm:meta ${id} i${n}.returns=${r}`);
      });
    }

    if (newNode.parent) block.push(`%% parent ${id} ${newNode.parent}`);

    const shape = kind === 'function' ? `("${newNode.label}")` : `["${newNode.label}"]`;
    block.push(`  ${id}${shape}`);
    block.push('');

    allNewLines.push(...block);
  }

  const addedIds = newChanges.map((c) => c.target.ref);

  if (dry) {
    console.log(`[dry-run] ${fragmentPath}: +${newChanges.length} new node(s) from plan (${addedIds.join(', ')})`);
    for (const l of allNewLines) console.log(`  + ${l}`);
    return;
  }

  // Append at end of file (after ensuring trailing newline)
  let out = fragmentText;
  if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  out += allNewLines.join('\n');
  // Ensure single trailing newline
  out = out.replace(/\n+$/, '\n');

  writeFileSync(fragmentPath, out);
  console.log(`${fragmentPath}: +${newChanges.length} new node(s) from plan (${addedIds.join(', ')})`);

  // Verify parseMmd still works cleanly
  parseMmd(readFileSync(fragmentPath, 'utf8'));
}

// ─── Main ─────────────────────────────────────────────────────────────

function main() {
  const tsconfig = arg('--tsconfig');
  const dry = hasFlag('--dry');
  const force = hasFlag('--force');

  if (hasFlag('--backfill')) {
    const fragment = arg('--backfill');
    if (!fragment || !tsconfig) {
      console.error('Usage: --backfill <fragment.mmd> --tsconfig <tsconfig.json> [--dry]');
      process.exit(2);
    }
    const project = new Project({ tsConfigFilePath: tsconfig });
    backfill(fragment, project, dry);
    return;
  }

  if (hasFlag('--init')) {
    const src = arg('--src');
    const out = arg('--out');
    if (!tsconfig || !src || !out) {
      console.error('Usage: --init --tsconfig <tsconfig.json> --src <srcDir> --out <outDir> [--force]');
      process.exit(2);
    }
    const project = new Project({ tsConfigFilePath: tsconfig });
    init(src, out, project, force, dry);
    return;
  }

  if (hasFlag('--add-from-plan')) {
    const planFile = arg('--add-from-plan');
    const fragment = arg('--fragment');
    if (!planFile || !fragment) {
      console.error('Usage: --add-from-plan <plan.json> --fragment <fragment.mmd> [--dry]');
      process.exit(2);
    }
    addFromPlan(planFile, fragment, dry);
    return;
  }

  console.error('Usage:');
  console.error('  scaffold.mjs --backfill <fragment.mmd> --tsconfig <tsconfig.json> [--dry]');
  console.error('  scaffold.mjs --init --tsconfig <tsconfig.json> --src <srcDir> --out <outDir> [--force]');
  console.error('  scaffold.mjs --add-from-plan <plan.json> --fragment <fragment.mmd> [--dry]');
  process.exit(2);
}

export { addFromPlan };

if (import.meta.url === `file://${process.argv[1]}`) main();
