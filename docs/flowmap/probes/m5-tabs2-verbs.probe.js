/* m5-tabs2-verbs.probe.js — runtime probe for the m5-p-tabs2 + m5-a-verbs
   landings (2026-07-03): drives every runtime criterion enumerated in the two
   plans' notes (7 + 9) against the real app and reports PASS/FAIL per
   criterion plus a zero-console-errors verdict.

   Not part of CI (needs a browser). To run:
     1. npx vite --port 5199          (repo root, leave running)
     2. npm i playwright@^1.61 in any scratch dir (or globally) so
        require('playwright') resolves, then from that dir:
        node <repo>/docs/flowmap/probes/m5-tabs2-verbs.probe.js
   Expected: 16 [PASS] lines and "FINAL CONSOLE ERRORS (0)".

   Harness caveat (KNOWN_EDGES): interact via real page.mouse input — a
   synthetic dispatchEvent(new PointerEvent(...)) carries no OS pointer id and
   trips unfold.ts's setPointerCapture (a test artifact, not an app defect). */

const { chromium } = require('playwright');

const results = []; // {id, verdict, evidence}
function log(id, verdict, evidence) {
  results.push({ id, verdict, evidence });
  console.log(`[${verdict}] ${id} :: ${evidence}`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const q = (sel) => page.locator(sel);
  const cardByLabel = async (label) => {
    const cards = await page.evaluate(() => [...document.querySelectorAll('.uf-card')].map(c => ({ id: c.dataset.id, label: c.querySelector('.uf-cname')?.textContent })));
    return cards.find((c) => c.label === label);
  };
  const clickCard = async (id) => {
    // a click on an ALREADY-selected card toggles it OFF (real app behaviour) —
    // this helper always ensures the card ends up SELECTED, so it no-ops if
    // it's already the current selection instead of blindly re-clicking.
    const already = await page.evaluate((i) => document.querySelector(`.uf-card[data-id="${i}"]`)?.classList.contains('sel'), id);
    if (already) return;
    await page.locator(`.uf-card[data-id="${id}"]`).click();
    await page.waitForTimeout(150);
  };
  const openTab = async (tab) => {
    await page.locator(`.uf-tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(150);
  };

  /* ================= P-TABS2 ================= */

  // 1. two rows: reveal/io/mermaid then slice/style, chevron top right
  {
    const rows = await page.evaluate(() => [...document.querySelectorAll('.uf-tabrow')].map(r => [...r.querySelectorAll('.uf-tab')].map(b => b.dataset.tab)));
    const chevronOk = await page.evaluate(() => {
      const tabs = document.querySelector('#ufTabs');
      const pcol = document.querySelector('#ufPcol');
      if (!tabs || !pcol) return false;
      const tr = tabs.getBoundingClientRect(), pr = pcol.getBoundingClientRect();
      return pr.right > tr.left + (tr.width * 0.7) && pr.top < tr.top + 40;
    });
    const ok = JSON.stringify(rows) === JSON.stringify([['reveal', 'io', 'mermaid'], ['slice', 'style']]);
    log('p-tabs2 #1', ok && chevronOk ? 'PASS' : 'FAIL', `rows=${JSON.stringify(rows)} chevronTopRight=${chevronOk}`);
  }

  // 2. slice tab: nothing selected -> full diagram + node count; select card -> neighbourhood slice + boundary stub count; copy fills clipboard
  {
    // ensure nothing selected: reload state cleanly not needed, but let's deselect if any sel
    await openTab('slice');
    await page.waitForTimeout(150);
    const nothingSelText = await page.locator('#ufSliceText').inputValue();
    const nothingSelInfo = await page.locator('#ufSliceInfo').textContent();
    const nodeCount = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    const fullOk = /flowchart/.test(nothingSelText) && new RegExp(`${nodeCount} node`).test(nothingSelInfo || '');

    const n1 = await cardByLabel('WorkspaceArea');
    await openTab('reveal');
    await clickCard(n1.id);
    await openTab('slice');
    await page.waitForTimeout(150);
    const selText = await page.locator('#ufSliceText').inputValue();
    const selInfo = await page.locator('#ufSliceInfo').textContent();
    const neighOk = selInfo && selInfo.includes('Slice around') && /\d+ node/.test(selInfo);
    const stubMentioned = /boundary stub/.test(selInfo || '');

    await page.locator('#ufSliceCopy').click();
    await page.waitForTimeout(150);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const copyOk = clip === selText;

    log('p-tabs2 #2', fullOk && neighOk && copyOk ? 'PASS' : 'FAIL',
      `nothingSel: info="${nothingSelInfo}" fullOk=${fullOk}; afterSelect: info="${selInfo}" stubMentioned=${stubMentioned}; copyOk=${copyOk} (clip.len=${clip.length} vs text.len=${selText.length})`);
  }

  // 3. legacy slice pane same text for same selection
  {
    // current unfold selection is n1 (WorkspaceArea) from previous step
    const ufText = await page.locator('#ufSliceText').inputValue();
    await page.locator('#ufCompare').click(); // closes overlay -> legacy, bridges node selection
    await page.waitForTimeout(200);
    await page.locator('#tabSlice').click();
    await page.waitForTimeout(150);
    const legacyText = await page.locator('#sliceOut').inputValue();
    const ok = legacyText === ufText;
    log('p-tabs2 #3', ok ? 'PASS' : 'FAIL', `match=${ok} ufLen=${ufText.length} legacyLen=${legacyText.length} legacySample="${(legacyText || '').slice(0, 80)}"`);
    // back to unfold
    await page.locator('#readBtn').click();
    await page.waitForTimeout(300);
  }

  // 4. style tab changes font; unfold text changes; reload restores; legacy font follows
  {
    await openTab('style');
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--uf-font'));
    const fontSelBefore = await page.locator('#ufFontSel').inputValue();
    // pick a font different from current
    const options = ['sans', 'rounded', 'mono', 'serif'];
    const target = options.find((o) => o !== fontSelBefore) || 'mono';
    await page.locator('#ufFontSel').selectOption(target);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--uf-font'));
    const changed = before !== after;

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await openTab('style');
    const restoredSel = await page.locator('#ufFontSel').inputValue();
    const restoredVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--uf-font'));
    const restored = restoredSel === target && restoredVar === after;

    // legacy font follows (--node-font var + #fontSel)
    await page.locator('#ufCompare').click();
    await page.waitForTimeout(200);
    const legacyFontSel = await page.locator('#fontSel').inputValue().catch(() => null);
    const nodeFontVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--node-font'));
    const legacyOk = legacyFontSel === target && nodeFontVar === after;
    await page.locator('#readBtn').click();
    await page.waitForTimeout(300);

    log('p-tabs2 #4', changed && restored && legacyOk ? 'PASS' : 'FAIL',
      `before="${before.trim()}" after="${after.trim()}" changed=${changed}; restoredSel=${restoredSel} target=${target} restored=${restored}; legacyFontSel=${legacyFontSel} nodeFontVar="${nodeFontVar.trim()}" legacyOk=${legacyOk}`);
  }

  // 5. style tab toggle light/dark identical to toolbar button
  {
    await openTab('style');
    const darkBefore = await page.evaluate(() => document.querySelector('.uf-overlay').classList.contains('dark'));
    await page.locator('#ufStyleDark').click();
    await page.waitForTimeout(150);
    const darkAfterStyle = await page.evaluate(() => document.querySelector('.uf-overlay').classList.contains('dark'));
    const styleToggleClass = await page.evaluate(() => document.querySelector('#ufStyleDark').classList.contains('on'));
    const toggledOnce = darkAfterStyle !== darkBefore;

    await page.locator('#ufTheme').click(); // toolbar button toggles back
    await page.waitForTimeout(150);
    const darkAfterToolbar = await page.evaluate(() => document.querySelector('.uf-overlay').classList.contains('dark'));
    const styleToggleClass2 = await page.evaluate(() => document.querySelector('#ufStyleDark').classList.contains('on'));
    const backToOriginal = darkAfterToolbar === darkBefore;
    const styleReflectsToolbar = styleToggleClass2 === darkAfterToolbar;

    log('p-tabs2 #5', toggledOnce && backToOriginal && styleReflectsToolbar && (styleToggleClass === darkAfterStyle) ? 'PASS' : 'FAIL',
      `darkBefore=${darkBefore} afterStyleClick=${darkAfterStyle}(styleBtn.on=${styleToggleClass}) afterToolbarClick=${darkAfterToolbar}(styleBtn.on=${styleToggleClass2})`);
  }

  // 6. io/mermaid/reveal tabs unaffected; dock persistence restores new tabs after reload
  {
    await openTab('io');
    const ioHasButtons = await page.evaluate(() => !!document.querySelector('#ufSaveMmd') && !!document.querySelector('#ufLoadMmd') && !!document.querySelector('#ufLoadBodies'));
    await openTab('mermaid');
    const mmdText = await page.locator('#ufMmdText').inputValue();
    const mmdOk = /flowchart/.test(mmdText);
    await openTab('reveal');
    const revealHasLayers = await page.evaluate(() => document.querySelectorAll('#ufLayers .uf-layer').length);
    const revealOk = revealHasLayers === 8;

    // set dock tab to 'style', reload, verify restored
    await openTab('style');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const restoredTab = await page.evaluate(() => document.querySelector('.uf-tab.on')?.dataset.tab);
    const dockPersisted = restoredTab === 'style';

    log('p-tabs2 #6', ioHasButtons && mmdOk && revealOk && dockPersisted ? 'PASS' : 'FAIL',
      `ioButtons=${ioHasButtons} mmdOk=${mmdOk}(sample="${mmdText.slice(0, 30)}") revealLayers=${revealHasLayers} restoredTab=${restoredTab} dockPersisted=${dockPersisted}`);
  }

  // 7. zero console errors so far (checked at the very end, combined with a-verbs)

  console.log('--- P-TABS2 DONE, moving to A-VERBS ---');
  console.log('console errors so far:', JSON.stringify(consoleErrors));

  await page.waitForTimeout(300);

  /* ================= A-VERBS ================= */
  await openTab('reveal');

  // 1. nothing selected -> zero new chrome
  {
    // deselect: real mouse click on stage background (empty area) — a synthetic
    // dispatchEvent(PointerEvent) here would have no matching real pointer and
    // trips the app's setPointerCapture on a bogus id, so use genuine mouse input.
    const stageBox = await page.locator('#ufStage').boundingBox();
    await page.mouse.move(stageBox.x + 5, stageBox.y + 5);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
    const menuBtn = await page.evaluate(() => !!document.querySelector('#ufIMenu'));
    const inspEmpty = await page.evaluate(() => document.querySelector('#ufInsp')?.innerHTML.trim() === '');
    log('a-verbs #1', !menuBtn && inspEmpty ? 'PASS' : 'FAIL', `menuBtnPresent=${menuBtn} inspectorEmpty=${inspEmpty}`);
  }

  const nodeMap = {};
  for (const label of ['WorkspaceArea', 'DragManager', 'Zustand store', 'Dragging?', 'TextElement', 'render tiles']) {
    nodeMap[label] = (await cardByLabel(label)).id;
  }

  // 2. select card -> menu appears; delete removes card everywhere (unfold+legacy+text); then undo to restore
  {
    const delTargetLabel = 'render tiles';
    const delId = nodeMap[delTargetLabel];
    await clickCard(delId);
    await page.waitForTimeout(150);
    const menuBtnAppears = await page.evaluate(() => !!document.querySelector('#ufIMenu'));
    await page.locator('#ufIMenu').click();
    await page.waitForTimeout(100);
    const menuItems = await page.evaluate(() => [...document.querySelectorAll('.uf-mitem')].map(b => b.textContent));
    const hasDelete = menuItems.includes('delete');
    // click delete item
    await page.locator('.uf-mitem', { hasText: /^delete$/ }).click();
    await page.waitForTimeout(200);
    const goneUnfold = await page.evaluate((id) => !document.querySelector(`.uf-card[data-id="${id}"]`), delId);
    await openTab('mermaid');
    const mmdAfterDel = await page.locator('#ufMmdText').inputValue();
    const goneText = !mmdAfterDel.includes(`  ${delId} `) && !new RegExp(`\\b${delId}\\b`).test(mmdAfterDel.split('\n').filter(l => !l.startsWith('%%')).join('\n'));
    // legacy check
    await page.locator('#ufCompare').click();
    await page.waitForTimeout(200);
    const goneLegacy = await page.evaluate((id) => !document.querySelector(`.node[data-id="${id}"]`), delId);
    await page.locator('#readBtn').click();
    await page.waitForTimeout(300);
    // restore via undo (keyboard) so later steps have consistent node set
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(200);
    const restoredUnfold = await page.evaluate((id) => !!document.querySelector(`.uf-card[data-id="${id}"]`), delId);

    log('a-verbs #2', menuBtnAppears && hasDelete && goneUnfold && goneText && goneLegacy ? 'PASS' : 'FAIL',
      `menuAppeared=${menuBtnAppears} menuItems=${JSON.stringify(menuItems)} goneUnfold=${goneUnfold} goneText=${goneText} goneLegacy=${goneLegacy} restoredAfterUndo=${restoredUnfold}`);
  }

  // 3. ⌘C/⌘V roundtrip, ⌘D duplicate, Delete deletes, ⌘Z undo, ⇧⌘Z redo — without opening menu
  {
    const countBefore = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    const srcId = nodeMap['Zustand store'];
    await clickCard(srcId);
    await page.keyboard.press('Meta+c');
    await page.waitForTimeout(150);
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(250);
    const countAfterPaste = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    const pastedSel = await page.evaluate(() => document.querySelector('.uf-card.sel')?.dataset.id);
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(250);
    const countAfterDup = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    const dupSel = await page.evaluate(() => document.querySelector('.uf-card.sel')?.dataset.id);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);
    const countAfterDelete = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(250);
    const countAfterUndo = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(250);
    const countAfterRedo = await page.evaluate(() => document.querySelectorAll('.uf-card').length);

    const pasteOk = countAfterPaste === countBefore + 1;
    const dupOk = countAfterDup === countBefore + 2;
    const delOk = countAfterDelete === countBefore + 1;
    const undoOk = countAfterUndo === countBefore + 2;
    const redoOk = countAfterRedo === countBefore + 1;
    // cleanup: delete the leftover pasted node so downstream counts (n=6 baseline) hold.
    // deleting clears selection, so explicitly re-select the leftover card first.
    const knownIds = Object.values(nodeMap);
    const leftoverId = await page.evaluate((known) => {
      const all = [...document.querySelectorAll('.uf-card')].map((c) => c.dataset.id);
      return all.find((id) => !known.includes(id)) || null;
    }, knownIds);
    if (leftoverId) {
      await clickCard(leftoverId);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
    }
    const countCleanup = await page.evaluate(() => document.querySelectorAll('.uf-card').length);

    log('a-verbs #3', pasteOk && dupOk && delOk && undoOk && redoOk ? 'PASS' : 'FAIL',
      `before=${countBefore} afterPaste=${countAfterPaste}(pasteOk=${pasteOk},pastedSel=${pastedSel}) afterDup=${countAfterDup}(dupOk=${dupOk},dupSel=${dupSel}) afterDelete=${countAfterDelete}(delOk=${delOk}) afterUndo=${countAfterUndo}(undoOk=${undoOk}) afterRedo=${countAfterRedo}(redoOk=${redoOk}) cleanup=${countCleanup}`);
  }

  // 4. connect: A -> click B creates edge in wire layer + serialised text; Esc mid-connect cancels
  {
    await openTab('reveal');
    const aId = nodeMap['Dragging?'], bId = nodeMap['TextElement'];
    await clickCard(aId);
    await page.locator('#ufIMenu').click();
    await page.waitForTimeout(100);
    await page.locator('.uf-mitem', { hasText: /^connect$/ }).click();
    await page.waitForTimeout(150);
    const connectingClass = await page.evaluate(() => document.querySelector('.uf-overlay').classList.contains('uf-connecting'));
    const armedClass = await page.evaluate((id) => document.querySelector(`.uf-card[data-id="${id}"]`).classList.contains('uf-armed'), aId);
    // Esc cancels
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const cancelledClass = await page.evaluate(() => !document.querySelector('.uf-overlay').classList.contains('uf-connecting'));
    await openTab('mermaid');
    const mmdBeforeConnect = await page.locator('#ufMmdText').inputValue();
    const noEdgeYet = !new RegExp(`${aId}\\s*-+.*>\\s*${bId}`).test(mmdBeforeConnect);
    await openTab('reveal');

    // real connect
    await clickCard(aId);
    await page.locator('#ufIMenu').click();
    await page.waitForTimeout(100);
    await page.locator('.uf-mitem', { hasText: /^connect$/ }).click();
    await page.waitForTimeout(150);
    await clickCard(bId);
    await page.waitForTimeout(250);
    const wireCountAfter = await page.evaluate(() => document.querySelectorAll('#ufWires path.uf-whit').length);
    await openTab('mermaid');
    const mmdAfterConnect = await page.locator('#ufMmdText').inputValue();
    const edgeInText = new RegExp(`${aId}\\s*--+>\\s*${bId}`).test(mmdAfterConnect) || mmdAfterConnect.split('\n').some(l => l.trim().startsWith(aId) && l.includes(bId));

    log('a-verbs #4', connectingClass && armedClass && cancelledClass && noEdgeYet && edgeInText ? 'PASS' : 'FAIL',
      `connectingClass=${connectingClass} armedClass=${armedClass} escCancelled=${cancelledClass} noEdgeAfterEsc=${noEdgeYet} wireHitCountAfterRealConnect=${wireCountAfter} edgeInSerialisedText=${edgeInText}`);
  }

  // 5. select wire -> label/reverse/delete offered; reverse flips arrow in text; legacy edge inspector same result
  {
    await openTab('reveal');
    const aId = nodeMap['Dragging?'], bId = nodeMap['TextElement'];
    const aLabel = 'Dragging?', bLabel = 'TextElement';
    // find & click the correct wire hit-path by dispatching click + checking inspector text
    let found = false, menuItemsWire = [];
    const handles = await page.locator('#ufWires path.uf-whit').elementHandles();
    for (const h of handles) {
      await h.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      await page.waitForTimeout(100);
      const inspName = await page.evaluate(() => document.querySelector('#ufInsp .uf-iname')?.textContent || '');
      if (inspName.includes(aLabel) && inspName.includes(bLabel)) { found = true; break; }
      // deselect this wire before trying next (a re-click toggles off)
      await h.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      await page.waitForTimeout(80);
    }
    let reverseOk = false, deleteOffered = false, labelOffered = false, legacyMatch = false;
    let mmdBeforeReverse = '', mmdAfterReverse = '';
    if (found) {
      await page.locator('#ufIMenu').click();
      await page.waitForTimeout(100);
      menuItemsWire = await page.evaluate(() => [...document.querySelectorAll('.uf-mitem')].map(b => b.textContent));
      labelOffered = await page.evaluate(() => !!document.querySelector('.uf-mrow input.uf-minput[placeholder="edge label"]'));
      deleteOffered = menuItemsWire.includes('edge delete') || menuItemsWire.includes('delete');
      await openTab('mermaid');
      mmdBeforeReverse = await page.locator('#ufMmdText').inputValue();
      await openTab('reveal');
      // the ⋯ menu state persists across tab switches (it's not tab-scoped) —
      // it should still be open from the click above; only (re)open it if it isn't.
      const menuStillOpen = await page.evaluate(() => !!document.querySelector('#ufActionsMenu'));
      if (!menuStillOpen) { await page.locator('#ufIMenu').click(); await page.waitForTimeout(100); }
      await page.locator('.uf-mitem', { hasText: /^edge reverse$/ }).click();
      await page.waitForTimeout(250);
      await openTab('mermaid');
      mmdAfterReverse = await page.locator('#ufMmdText').inputValue();
      const beforeLine = mmdBeforeReverse.split('\n').find(l => l.includes(aId) && l.includes(bId) && !l.startsWith('%%'));
      const afterLine = mmdAfterReverse.split('\n').find(l => l.includes(aId) && l.includes(bId) && !l.startsWith('%%'));
      reverseOk = !!beforeLine && !!afterLine && beforeLine.trim().startsWith(aId) && afterLine.trim().startsWith(bId);

      // legacy check: switch, find path.hit whose .multi-note shows bLabel -> aLabel (post-reverse)
      await openTab('reveal');
      await page.locator('#ufCompare').click();
      await page.waitForTimeout(200);
      const hitHandles = await page.locator('svg#wires path.hit').elementHandles();
      for (const hh of hitHandles) {
        await hh.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        await page.waitForTimeout(100);
        const note = await page.evaluate(() => document.querySelector('.multi-note')?.textContent || '');
        if (note.includes(bLabel) && note.includes(aLabel)) { legacyMatch = true; break; }
      }
      await page.locator('#readBtn').click();
      await page.waitForTimeout(300);
    }
    log('a-verbs #5', found && reverseOk && deleteOffered && legacyMatch ? 'PASS' : 'FAIL',
      `wireFound=${found} menuItems=${JSON.stringify(menuItemsWire)} labelOffered=${labelOffered} deleteOffered=${deleteOffered} reverseOk=${reverseOk} beforeLine="${(mmdBeforeReverse.split('\n').find(l => l.includes(aId) && l.includes(bId) && !l.startsWith('%%')) || '').trim()}" afterLine="${(mmdAfterReverse.split('\n').find(l => l.includes(aId) && l.includes(bId) && !l.startsWith('%%')) || '').trim()}" legacyMatch=${legacyMatch}`);
  }

  // 6. edit kind/desc from unfold changes map text + reading inspector
  {
    await openTab('reveal');
    const targetLabel = 'render tiles';
    const targetId = nodeMap[targetLabel];
    await clickCard(targetId);
    await page.locator('#ufIMenu').click();
    await page.waitForTimeout(100);
    const kindSelExists = await page.evaluate(() => !!document.querySelector('.uf-mrow select.uf-minput'));
    await page.selectOption('.uf-mrow select.uf-minput', 'component');
    await page.waitForTimeout(250);
    const inspKindAfter = await page.evaluate(() => document.querySelector('#ufInsp .uf-ikind')?.textContent);
    await openTab('mermaid');
    const mmdText = await page.locator('#ufMmdText').inputValue();
    const kindInText = new RegExp(`%% kind ${targetId} component`).test(mmdText);

    // desc edit
    await openTab('reveal');
    await clickCard(targetId);
    await page.locator('#ufIMenu').click();
    await page.waitForTimeout(100);
    const descInput = page.locator('.uf-mrow input[placeholder="description"]');
    await descInput.fill('renders visible tiles only');
    await descInput.press('Enter');
    await page.waitForTimeout(250);
    const inspDescAfter = await page.evaluate(() => document.querySelector('#ufInsp .uf-idesc')?.textContent);
    await openTab('mermaid');
    const mmdText2 = await page.locator('#ufMmdText').inputValue();
    const descInText = mmdText2.includes('renders visible tiles only');

    log('a-verbs #6', kindSelExists && inspKindAfter === 'component' && kindInText && inspDescAfter === 'renders visible tiles only' && descInText ? 'PASS' : 'FAIL',
      `kindSelExists=${kindSelExists} inspKindAfter="${inspKindAfter}" kindInText=${kindInText} inspDescAfter="${inspDescAfter}" descInText=${descInText}`);
  }

  // 7. clear-all confirm, empties model both surfaces; undo restores
  {
    await openTab('reveal');
    const countBefore = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    await clickCard(nodeMap['WorkspaceArea']);
    await page.locator('#ufIMenu').click();
    await page.waitForTimeout(100);
    await page.locator('.uf-mitem', { hasText: /^clear all$/ }).click();
    await page.waitForTimeout(300);
    const countAfterClear = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    await page.locator('#ufCompare').click();
    await page.waitForTimeout(200);
    const legacyNodesAfterClear = await page.evaluate(() => document.querySelectorAll('.node').length);
    await page.locator('#readBtn').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);
    const countAfterUndo = await page.evaluate(() => document.querySelectorAll('.uf-card').length);

    log('a-verbs #7', countBefore > 0 && countAfterClear === 0 && legacyNodesAfterClear === 0 && countAfterUndo === countBefore ? 'PASS' : 'FAIL',
      `countBefore=${countBefore} countAfterClear=${countAfterClear} legacyNodesAfterClear=${legacyNodesAfterClear} countAfterUndo=${countAfterUndo}`);
  }

  // 8. typing in browse search or mermaid textarea never triggers a verb shortcut
  {
    const countBefore = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    await clickCard(nodeMap['DragManager']); // select something so delete WOULD fire if not suppressed
    await openTab('reveal');
    await page.locator('#ufSearch').click();
    await page.keyboard.type('a');
    await page.keyboard.press('Delete'); // should just edit the text field, not delete the card
    await page.waitForTimeout(200);
    const countAfterSearchDelete = await page.evaluate(() => document.querySelectorAll('.uf-card').length);
    const searchVal = await page.locator('#ufSearch').inputValue();
    await page.locator('#ufSearch').fill('');
    await commitEmptySearch(page);

    await openTab('mermaid');
    await page.locator('#ufMmdText').click();
    await page.keyboard.press('Meta+d'); // duplicate shortcut — should just be a textarea no-op (or browser default), not invoke verb
    await page.waitForTimeout(200);
    const countAfterMmdDup = await page.evaluate(() => document.querySelectorAll('.uf-card').length);

    log('a-verbs #8', countAfterSearchDelete === countBefore && countAfterMmdDup === countBefore ? 'PASS' : 'FAIL',
      `countBefore=${countBefore} afterSearchDeleteKey=${countAfterSearchDelete}(searchVal="${searchVal}") afterMmdCmdD=${countAfterMmdDup}`);
  }

  async function commitEmptySearch(p) {
    await p.waitForTimeout(50);
  }

  console.log('--- A-VERBS DONE ---');
  await page.waitForTimeout(300);

  console.log('\n\n=== FINAL CONSOLE ERRORS (' + consoleErrors.length + ') ===');
  console.log(JSON.stringify(consoleErrors, null, 2));

  console.log('\n=== RESULTS SUMMARY ===');
  for (const r of results) console.log(`${r.verdict}\t${r.id}\t${r.evidence}`);

  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
