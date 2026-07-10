#!/usr/bin/env node
/**
 * scaffold.mjs — Novakai scaffold tool
 *
 * Three modes:
 *   --backfill <fragment.mmd>  Read %% src directives, find real TS signatures,
 *                              inject i0.accepts/i0.returns lines with real types
 *                              for leaf nodes that lack them. Idempotent.
 *   --init                     Walk a TS project with no fragments, emit draft
 *                              fragments + root.mmd with all mechanical lines
 *                              pre-filled. Output FAILS novakai-lint by design.
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
const FLOWCHART_HEADER = 'flowchart LR';

// ─── Helpers ──────────────────────────────────────────────────────────

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}

/** Record a %% src directive into the fragment state. */
function applySrcDirective(match, lineIndex, state) {
  const id = match[1];
  const raw = match[2];
  const hashIdx = raw.indexOf('#');
  state.srcMap[id] = {
    path: hashIdx >= 0 ? raw.slice(0, hashIdx) : raw, symbol: hashIdx >= 0 ? raw.slice(hashIdx + 1) : id,
  };
  state.lastRefLine[id] = lineIndex;
}

/** Record a %% fm:meta directive into the fragment state. */
function applyMetaDirective(match, lineIndex, state) {
  const id = match[1];
  const rest = match[2];
  state.lastMetaLine[id] = lineIndex;
  state.lastRefLine[id] = lineIndex;
  if (rest.startsWith('name=')) {
    state.nameMap[id] = rest.slice(5).trim();
  }
  if (/^i\d+\.name=/.test(rest)) {
    state.hasInterface.add(id);
  }
}

/** Parse one fragment line, updating state for whichever directive it is. */
function applyFragmentLine(line, lineIndex, state) {
  const srcMatch = D_SRC.exec(line);
  if (srcMatch) {
    applySrcDirective(srcMatch, lineIndex, state);
    return;
  }

  const kindMatch = D_KIND.exec(line);
  if (kindMatch) {
    state.kindMap[kindMatch[1]] = kindMatch[2];
    state.lastRefLine[kindMatch[1]] = lineIndex;
    return;
  }

  const metaMatch = D_FM_META.exec(line);
  if (metaMatch) applyMetaDirective(metaMatch, lineIndex, state);
}

/** Parse a fragment file into structured data. */
function parseFragment(text) {
  const lines = text.split('\n');
  // srcMap: id→{path,symbol}; kindMap: id→kind; nameMap: id→name;
  // hasInterface: ids with i<N>.name=; lastMetaLine/lastRefLine: id→last directive line index
  const state = {
    srcMap: {}, kindMap: {}, nameMap: {}, hasInterface: new Set(),
    lastMetaLine: {}, lastRefLine: {},
  };

  for (let i = 0; i < lines.length; i++) applyFragmentLine(lines[i], i, state);

  return { lines, ...state };
}

/** True for class members not marked private/protected. */
function isPublicMember(member) {
  const scope = member.getScope ? member.getScope() : 'public';
  return scope !== 'private' && scope !== 'protected';
}

/** Push the i<N>.name/accepts/returns lines for one member into lines. */
function pushMemberInterfaceLines(lines, id, idx, member) {
  const memSig = signatureAtBanner(member);
  lines.push(`%% fm:meta ${id} i${idx}.name=${member.getName()}`);
  for (const accepted of memSig.accepts) {
    lines.push(`%% fm:meta ${id} i${idx}.accepts=${accepted}`);
  }
  if (memSig.returns) {
    lines.push(`%% fm:meta ${id} i${idx}.returns=${memSig.returns}`);
  }
}

/** Generate interface lines from a list of class/interface members. */
function memberInterfaceLines(id, members) {
  const lines = [];
  members.forEach((member, idx) => pushMemberInterfaceLines(lines, id, idx, member));
  return lines;
}

/** Generate the single i0 interface entry for a function/hook declaration. */
function functionInterfaceLines(id, symbol, decl) {
  const sig = signatureAtBanner(decl);
  const lines = [`%% fm:meta ${id} i0.name=${symbol}`];
  for (const accepted of sig.accepts) {
    lines.push(`%% fm:meta ${id} i0.accepts=${accepted}`);
  }
  if (sig.returns) {
    lines.push(`%% fm:meta ${id} i0.returns=${sig.returns}`);
  }
  return lines;
}

/** Generate interface lines for a node from its real TS signature. */
function interfaceLines(id, symbol, kind, decl) {
  // For classes, iterate methods; for functions, the signature IS the interface
  if (kind === 'class' && Node.isClassDeclaration(decl)) {
    return memberInterfaceLines(id, decl.getInstanceMethods().filter(isPublicMember));
  }

  // For interfaces/types, iterate methods
  if (kind === 'type' && Node.isInterfaceDeclaration(decl)) {
    return memberInterfaceLines(id, decl.getMethods());
  }

  // For functions/hooks: single interface entry
  return functionInterfaceLines(id, symbol, decl);
}

// ─── Backfill mode ────────────────────────────────────────────────────

/** Resolve the ts-morph declaration for a fragment's %% src path#symbol. */
function resolveBackfillDecl(project, path, symbol) {
  const sourceFile = project.getSourceFile(resolve(path));
  if (!sourceFile) return null;
  return findSymbol(sourceFile, symbol);
}

/**
 * Decide what backfill does with one node id: 'skipped', 'notFound', or
 * 'added' (with the { insertAfter, lines } addition to apply).
 */
function backfillOneNode(id, frag, project) {
  // Skip if already has interface declarations
  if (frag.hasInterface.has(id)) return { status: 'skipped' };

  const kind = frag.kindMap[id];
  if (!kind || !GATED.has(kind)) return { status: 'skipped' };

  const { path, symbol } = frag.srcMap[id];
  const decl = resolveBackfillDecl(project, path, symbol);
  if (!decl) return { status: 'notFound' };

  const newLines = interfaceLines(id, symbol, kind, decl);
  if (newLines.length === 0) return { status: 'skipped' };

  // Insertion point: after the last %% fm:meta <id> line, or after
  // the last %% reference (kind/src) line as fallback
  const insertAfter = frag.lastMetaLine[id] ?? frag.lastRefLine[id] ?? -1;
  if (insertAfter < 0) return { status: 'skipped' };

  return { status: 'added', addition: { insertAfter, lines: newLines } };
}

/** Run backfillOneNode over every id in the fragment, tallying outcomes. */
function collectBackfillAdditions(frag, project) {
  const additions = []; // { insertAfter, lines }
  let skipped = 0;
  let notFound = 0;

  for (const id of Object.keys(frag.srcMap)) {
    const outcome = backfillOneNode(id, frag, project);
    if (outcome.status === 'added') additions.push(outcome.addition);
    else if (outcome.status === 'notFound') notFound++;
    else skipped++;
  }

  return { additions, skipped, notFound };
}

function reportBackfillDryRun(fragmentPath, result) {
  console.log(`[dry-run] ${fragmentPath}`);
  console.log(`  would add interfaces for ${result.additions.length} nodes, ` +
    `skip ${result.skipped}, not found ${result.notFound}`);
  for (const addition of result.additions) {
    console.log(`  --- insert after line ${addition.insertAfter + 1} ---`);
    for (const line of addition.lines) console.log(`  + ${line}`);
  }
}

/** Splice all additions into fragLines (bottom-to-top) and write the file. */
function writeBackfillAdditions(fragmentPath, fragLines, additions) {
  // Sort additions by insertAfter descending (bottom-to-top) so line
  // numbers don't shift during insertion
  const sorted = [...additions].sort((left, right) => right.insertAfter - left.insertAfter);

  const outLines = [...fragLines];
  for (const addition of sorted) {
    outLines.splice(addition.insertAfter + 1, 0, ...addition.lines);
  }

  writeFileSync(fragmentPath, outLines.join('\n'));
}

function backfill(fragmentPath, project, dry) {
  const text = readFileSync(fragmentPath, 'utf8');
  const frag = parseFragment(text);
  const result = collectBackfillAdditions(frag, project);

  if (dry) {
    reportBackfillDryRun(fragmentPath, result);
    return;
  }

  writeBackfillAdditions(fragmentPath, frag.lines, result.additions);
  console.log(`${fragmentPath}: +${result.additions.length} interface blocks ` +
    `(${result.additions.length} nodes backfilled, ${result.skipped} skipped, ${result.notFound} not found)`);
}

// ─── Init mode ────────────────────────────────────────────────────────

function shouldSkipFile(filePath) {
  for (const suffix of SKIP_SUFFIXES) {
    if (filePath.endsWith(suffix)) return true;
  }
  return false;
}

function shouldSkipDir(dirPath) {
  for (const dir of SKIP_DIRS) {
    if (dirPath.includes(`/${dir}/`) || dirPath.endsWith(`/${dir}`)) return true;
  }
  return false;
}

/** Push one { symbol, kind, file, relPath, node } entry per exported declaration. */
function pushExportedDeclarations(list, declarations, kind, fileInfo) {
  for (const decl of declarations) {
    if (!decl.isExported() || !decl.getName()) continue;
    list.push({ symbol: decl.getName(), kind, file: fileInfo.filePath, relPath: fileInfo.relPath, node: decl });
  }
}

/** The folder's symbol list in byFolder, creating it on first use. */
function ensureFolderList(byFolder, folder) {
  if (!byFolder[folder]) byFolder[folder] = [];
  return byFolder[folder];
}

/** Collect the exported classes/interfaces/functions of one source file. */
function collectSymbolsFromFile(sourceFile, srcDir, byFolder) {
  const filePath = sourceFile.getFilePath().replace(/\\/g, '/');
  if (filePath.includes('node_modules')) return;

  const relPath = relative(resolve(srcDir), filePath);
  if (relPath.startsWith('..')) return; // outside src dir
  if (shouldSkipFile(filePath)) return;

  const folder = dirname(relPath);
  if (shouldSkipDir(folder)) return;

  const list = ensureFolderList(byFolder, folder);
  const fileInfo = { filePath, relPath };

  pushExportedDeclarations(list, sourceFile.getClasses(), 'class', fileInfo);
  pushExportedDeclarations(list, sourceFile.getInterfaces(), 'type', fileInfo);
  pushExportedDeclarations(list, sourceFile.getFunctions(), 'function', fileInfo);
}

/** Collect exported symbols from a TS project, grouped by folder. */
function collectSymbols(project, srcDir) {
  const byFolder = {}; // relativeFolder → [{ symbol, kind, file, relPath }]
  for (const sourceFile of project.getSourceFiles()) {
    collectSymbolsFromFile(sourceFile, srcDir, byFolder);
  }
  return byFolder;
}

/** Derive a container/node id from a folder path (last segment, sanitized). */
function folderContainerId(folder) {
  return folder.split('/').pop().replace(/[^A-Za-z0-9_]/g, '_');
}

/** Push the %% src/kind/fm:meta/interface lines for one symbol, plus a node id entry. */
function pushOneSymbolLines(lines, nodeIds, sym, srcDir) {
  const id = sym.symbol;
  nodeIds.push({ id: sym.symbol, kind: sym.kind, label: sym.symbol });

  const relPath = relative(resolve(srcDir), sym.file);
  const srcPath = relative(process.cwd(), sym.file);

  lines.push(`%% src ${id} ${srcPath}#${sym.symbol}`);
  lines.push(`%% kind ${id} ${sym.kind}`);
  lines.push(`%% fm:meta ${id} name=${sym.symbol}`);
  lines.push(`%% fm:meta ${id} desc=`);

  if (GATED.has(sym.kind)) {
    for (const line of interfaceLines(id, sym.symbol, sym.kind, sym.node)) lines.push(line);
  }
  lines.push('');
}

/** Build the metadata lines + node id list for every symbol in a folder. */
function buildSymbolLines(symbols, srcDir) {
  const lines = [];
  const nodeIds = [];
  for (const sym of symbols) pushOneSymbolLines(lines, nodeIds, sym, srcDir);
  return { lines, nodeIds };
}

/** Build the `  id(shape)` node-definition lines. */
function buildNodeDefLines(nodeIds) {
  return nodeIds.map((nodeId) => {
    const shape = nodeId.kind === 'function' ? `("${nodeId.label}")` : `["${nodeId.label}"]`;
    return `  ${nodeId.id}${shape}`;
  });
}

/** Collect the dotted import-edge lines (raw imports, informational only) for one symbol. */
function collectImportEdgesForSymbol(edgeSet, sym, symbols) {
  const sourceFile = sym.node.getSourceFile();
  for (const imp of sourceFile.getImportDeclarations()) {
    const resolved = imp.getModuleSpecifierSourceFile();
    if (!resolved) continue;
    const importedNames = imp.getNamedImports().map((named) => named.getName());
    for (const name of importedNames) {
      if (symbols.some((candidate) => candidate.symbol === name) && name !== sym.symbol) {
        edgeSet.add(`${name} -.-> ${sym.symbol}`);
      }
    }
  }
}

/** Build the sorted dotted import-edge lines for a folder's symbols. */
function buildImportEdgeLines(symbols) {
  const edgeSet = new Set();
  for (const sym of symbols) collectImportEdgesForSymbol(edgeSet, sym, symbols);
  return [...edgeSet].sort();
}

/** Generate a draft fragment for a folder. */
function draftFragment(folder, symbols, srcDir) {
  const containerId = folderContainerId(folder);
  const lines = [
    FLOWCHART_HEADER, `%% root ${containerId}`,
    `%% AUTO-GENERATED DRAFT — edit sections, desc, spine edges before shipping`, '',
  ];

  const { lines: symbolLines, nodeIds } = buildSymbolLines(symbols, srcDir);
  lines.push(...symbolLines);
  lines.push(...buildNodeDefLines(nodeIds));
  lines.push('');
  for (const edge of buildImportEdgeLines(symbols)) lines.push(`  ${edge}`);

  return { containerId, content: lines.join('\n') + '\n' };
}

/** Build the container node list + their %% kind/fm:meta lines, one per folder. */
function buildContainerLines(folders) {
  const lines = [];
  const containers = [];
  for (const folder of folders) {
    const id = folderContainerId(folder);
    containers.push({ id, label: folder.split('/').pop() });

    lines.push(`%% kind ${id} module`);
    lines.push(`%% fm:meta ${id} name=${id}`);
    lines.push(`%% fm:meta ${id} desc=`);
    lines.push('');
  }
  return { lines, containers };
}

/** Build the `  id["label"]` node-definition lines for the root containers. */
function buildContainerNodeDefLines(containers) {
  return containers.map((container) => `  ${container.id}["${container.label}"]`);
}

/** Generate a draft root.mmd from collected folders. */
function draftRoot(folders, srcDir) {
  const { lines: containerLines, containers } = buildContainerLines(folders);

  const lines = [
    FLOWCHART_HEADER, '%% AUTO-GENERATED DRAFT — edit container names, desc, spine edges before shipping', '',
    ...containerLines,
  ];

  // Root directive — pick the most connected folder (heuristic: src/ root)
  const rootId = containers.length > 0 ? containers[0].id : 'main';
  lines[0] = FLOWCHART_HEADER;
  lines.splice(1, 0, `%% root ${rootId}`);

  lines.push(...buildContainerNodeDefLines(containers));
  lines.push('');

  return lines.join('\n') + '\n';
}

/** Write root.mmd, honoring --dry / --force the same way as the fragment writer below. */
function writeRootFile(rootPath, folders, srcDir, opts) {
  if (opts.dry) {
    console.log(`[dry-run] would write: ${rootPath} (${folders.length} containers)`);
    return;
  }
  if (existsSync(rootPath) && !opts.force) {
    console.log(`SKIP (exists): ${rootPath}  (use --force to overwrite)`);
    return;
  }
  writeFileSync(rootPath, draftRoot(folders, srcDir));
  console.log(`WROTE: ${rootPath} (${folders.length} containers)`);
}

/** Write one fragment file; returns true if it was written or would be (dry). */
function writeFragmentFile(target, opts) {
  const { fragPath, fragDir, content, symbolCount } = target;
  if (opts.dry) {
    console.log(`[dry-run] would write: ${fragPath} (${symbolCount} nodes)`);
    return true;
  }
  if (existsSync(fragPath) && !opts.force) {
    console.log(`SKIP (exists): ${fragPath}  (use --force to overwrite)`);
    return false;
  }
  if (!existsSync(fragDir)) mkdirSync(fragDir, { recursive: true });
  writeFileSync(fragPath, content);
  console.log(`WROTE: ${fragPath} (${symbolCount} nodes)`);
  return true;
}

/** Write one fragment per folder — mirrors source structure under outRoot. */
function writeFragmentsForFolders(scope, opts) {
  const { folders, byFolder, srcDir, outRoot } = scope;
  let totalNodes = 0;
  for (const folder of folders) {
    const symbols = byFolder[folder];
    const { containerId, content } = draftFragment(folder, symbols, srcDir);

    const fragDir = join(outRoot, folder);
    const fragPath = join(fragDir, `${containerId}.novakai.mmd`);
    const wrote = writeFragmentFile({ fragPath, fragDir, content, symbolCount: symbols.length }, opts);
    if (wrote) totalNodes += symbols.length;
  }
  return totalNodes;
}

function printInitNextSteps(outRoot) {
  console.log('\nNext steps:');
  console.log(`  1. Move fragments from ${outRoot}/ to your source folders`);
  console.log('  2. Add prose desc= for each node');
  console.log('  3. Group nodes into purpose-named subgraphs');
  console.log('  4. Wire solid spine edges (-->)');
  console.log('  5. Curate dotted reference edges (-.->)');
  console.log('  6. Run npm run novakai:ship until lint passes');
}

function init(srcDir, outDir, project, opts) {
  const byFolder = collectSymbols(project, srcDir);
  const folders = Object.keys(byFolder).filter((folder) => byFolder[folder].length > 0).sort();

  if (folders.length === 0) {
    console.error('No exported symbols found under', srcDir);
    process.exit(1);
  }

  // Ensure outDir exists
  const outRoot = resolve(outDir);
  if (!opts.dry && !existsSync(outRoot)) mkdirSync(outRoot, { recursive: true });

  // Write root.mmd — goes to --out directory
  writeRootFile(join(outRoot, 'root.mmd'), folders, srcDir, opts);

  // Write one fragment per folder — also goes under --out (mirrors source
  // structure). User moves them to source folders for bundler to find.
  const totalNodes = writeFragmentsForFolders({ folders, byFolder, srcDir, outRoot }, opts);

  console.log(`\nDone. ${folders.length} folders, ${totalNodes} nodes.`);
  if (!opts.dry) printInitNextSteps(outRoot);
}

// ─── Add-from-plan mode ───────────────────────────────────────────────

/** Add-node changes from a plan whose target isn't already in the fragment. */
function selectAddNodeChanges(planJson) {
  const changes = Array.isArray(planJson.changes) ? planJson.changes : [];
  return changes.filter(
    (change) => change.status === 'add' && change.target && change.target.kind === 'node' && change.newNode,
  );
}

/** Node ids already present in the fragment, per %% kind directives and node defs. */
function collectExistingIds(fragmentText) {
  const frag = parseFragment(fragmentText);
  const existingIds = new Set(Object.keys(frag.kindMap));

  // Also check parseMmd to catch node-def lines without a %% kind directive
  const parsed = parseMmd(fragmentText);
  for (const id of Object.keys(parsed.nodes)) existingIds.add(id);
  return existingIds;
}

/** The add-node changes from the plan that are genuinely new. */
function computeNewChanges(planJson, fragmentText) {
  const addChanges = selectAddNodeChanges(planJson);
  const existingIds = collectExistingIds(fragmentText);
  return addChanges.filter((change) => !existingIds.has(change.target.ref));
}

/** Push the i<N>.name/accepts/returns fm:meta lines for a plan node's interfaces. */
function pushInterfaceBlockLines(block, id, interfaces) {
  interfaces.forEach((iface, idx) => {
    if (iface.name !== undefined) block.push(`%% fm:meta ${id} i${idx}.name=${iface.name}`);
    for (const accepted of (iface.accepts || [])) block.push(`%% fm:meta ${id} i${idx}.accepts=${accepted}`);
    for (const returned of (iface.returns || [])) block.push(`%% fm:meta ${id} i${idx}.returns=${returned}`);
  });
}

/** The kind/label/desc a plan change's newNode + fm resolve to. */
function planNodeMeta(change) {
  const newNode = change.newNode;
  const frontmatter = change.fm;
  return {
    frontmatter,
    kind: newNode.kind || 'module',
    label: (frontmatter && frontmatter.name) || newNode.label,
    desc: (frontmatter && frontmatter.description) || '',
  };
}

/** Build the block of %% directive + node-def lines for one add-node change. */
function buildNodeBlock(change) {
  const id = change.target.ref;
  const newNode = change.newNode;
  const meta = planNodeMeta(change);

  const block = [
    `%% kind ${id} ${meta.kind}`, `%% fm:meta ${id} name=${meta.label}`, `%% fm:meta ${id} desc=${meta.desc}`,
  ];

  if (meta.frontmatter && Array.isArray(meta.frontmatter.interfaces)) {
    pushInterfaceBlockLines(block, id, meta.frontmatter.interfaces);
  }
  if (newNode.parent) block.push(`%% parent ${id} ${newNode.parent}`);

  const shape = meta.kind === 'function' ? `("${newNode.label}")` : `["${newNode.label}"]`;
  block.push(`  ${id}${shape}`);
  block.push('');

  return block;
}

/** Build the block of lines for every new node, concatenated in plan order. */
function buildAllNewLines(newChanges) {
  const allNewLines = [];
  for (const change of newChanges) allNewLines.push(...buildNodeBlock(change));
  return allNewLines;
}

function reportAddFromPlanDryRun(fragmentPath, newChanges, allNewLines) {
  const addedIds = newChanges.map((change) => change.target.ref);
  console.log(`[dry-run] ${fragmentPath}: +${newChanges.length} new node(s) from plan (${addedIds.join(', ')})`);
  for (const line of allNewLines) console.log(`  + ${line}`);
}

/** Append the new-node lines to the fragment file and write it. */
function writeAddFromPlanResult(fragmentPath, fragmentText, newChanges, allNewLines) {
  // Append at end of file (after ensuring trailing newline)
  let out = fragmentText;
  if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  out += allNewLines.join('\n');
  // Ensure single trailing newline
  out = out.replace(/\n+$/, '\n');

  writeFileSync(fragmentPath, out);
  const addedIds = newChanges.map((change) => change.target.ref);
  console.log(`${fragmentPath}: +${newChanges.length} new node(s) from plan (${addedIds.join(', ')})`);

  // Verify parseMmd still works cleanly
  parseMmd(readFileSync(fragmentPath, 'utf8'));
}

/**
 * Append new nodes from an approved plan into a novakai fragment.
 * Exported for use in tests. Idempotent.
 *
 * @param {string} planPath  path to the plan JSON file
 * @param {string} fragmentPath  path to the fragment .mmd file
 * @param {boolean} dry  if true, print the lines that would be added but do not write
 */
function addFromPlan(planPath, fragmentPath, dry) {
  const planJson = JSON.parse(readFileSync(planPath, 'utf8'));
  const fragmentText = readFileSync(fragmentPath, 'utf8');
  const newChanges = computeNewChanges(planJson, fragmentText);

  if (newChanges.length === 0) {
    console.log(`${fragmentPath}: no new nodes to add`);
    return;
  }

  const allNewLines = buildAllNewLines(newChanges);

  if (dry) {
    reportAddFromPlanDryRun(fragmentPath, newChanges, allNewLines);
    return;
  }

  writeAddFromPlanResult(fragmentPath, fragmentText, newChanges, allNewLines);
}

// ─── Main ─────────────────────────────────────────────────────────────

function runBackfillMode(tsconfig, dry) {
  const fragment = arg('--backfill');
  if (!fragment || !tsconfig) {
    console.error('Usage: --backfill <fragment.mmd> --tsconfig <tsconfig.json> [--dry]');
    process.exit(2);
  }
  const project = new Project({ tsConfigFilePath: tsconfig });
  backfill(fragment, project, dry);
}

function runInitMode(tsconfig, opts) {
  const src = arg('--src');
  const out = arg('--out');
  if (!tsconfig || !src || !out) {
    console.error('Usage: --init --tsconfig <tsconfig.json> --src <srcDir> --out <outDir> [--force]');
    process.exit(2);
  }
  const project = new Project({ tsConfigFilePath: tsconfig });
  init(src, out, project, opts);
}

function runAddFromPlanMode(dry) {
  const planFile = arg('--add-from-plan');
  const fragment = arg('--fragment');
  if (!planFile || !fragment) {
    console.error('Usage: --add-from-plan <plan.json> --fragment <fragment.mmd> [--dry]');
    process.exit(2);
  }
  addFromPlan(planFile, fragment, dry);
}

function printUsageAndExit() {
  console.error('Usage:');
  console.error('  scaffold.mjs --backfill <fragment.mmd> --tsconfig <tsconfig.json> [--dry]');
  console.error('  scaffold.mjs --init --tsconfig <tsconfig.json> --src <srcDir> --out <outDir> [--force]');
  console.error('  scaffold.mjs --add-from-plan <plan.json> --fragment <fragment.mmd> [--dry]');
  process.exit(2);
}

function main() {
  const tsconfig = arg('--tsconfig');
  const dry = hasFlag('--dry');

  if (hasFlag('--backfill')) {
    runBackfillMode(tsconfig, dry);
    return;
  }

  if (hasFlag('--init')) {
    runInitMode(tsconfig, { force: hasFlag('--force'), dry });
    return;
  }

  if (hasFlag('--add-from-plan')) {
    runAddFromPlanMode(dry);
    return;
  }

  printUsageAndExit();
}

export { addFromPlan };

if (import.meta.url === `file://${process.argv[1]}`) main();
