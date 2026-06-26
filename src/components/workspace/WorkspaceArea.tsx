import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useDocumentStorage } from "../../storage/useDocumentStorage";
import { COMPONENT_REGISTRY } from "../../types/registry";
import type {
  TextElement,
  MouseEventData,
  KeyEventData,
  LifecycleEventData,
  FilesDataSet,
  SelectionSnapshot,
  DocDraft,
} from "../../types/types";
import { buildDraft } from "../../managers/draft";
import { layoutKey } from "../../model/model";
import type { TriggerWord } from "../../types/trigger-words";
import type { NewSelectionManager } from "../../managers/selection/selection/NEWSelectionManager";
import type DragManager from "../../components/blocks/draggable/dragManager/DragManager";
import type BlockManager from "../../managers/blockManager/blockManager";
import type LayoutManager from "../../managers/layout/layoutManager";
import DragContainer from "../../components/blocks/draggable/dragContainer/DragContainer";
import WorkspaceEmptyState from "./WorkspaceEmptyState";
import {
  useWorkspacePointerBridge,
  mouseEventDataFrom,
} from "./modules/useWorkspacePointerBridge";
import { usePanelEventBridge } from "./modules/usePanelEventBridge";
import "./styles/workspace.css";

interface WorkspaceAreaProps {
  sm: NewSelectionManager;
  dm: DragManager;
  bm: BlockManager;
  lm: LayoutManager;
}

// @flowmap-node workspace__buildRoots kind=function
function buildRoots(nodes: TextElement[]): TextElement[] {
  return nodes.filter((node) => node.parentId === null);
}

// Put the caret inside a contentEditable at its start or end. Used after a
// structural change re-renders, so the freshly created block is focused and
// ready to type into. Pure DOM — the only place WSA writes the native caret.
// @flowmap-node workspace__placeCaret kind=function
function placeCaret(el: HTMLElement, edge: "start" | "end"): void {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(edge === "start"); // true = collapse to start
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// @flowmap-node workspace kind=component
export default function WorkspaceArea({ sm, dm, bm, lm }: WorkspaceAreaProps) {
  // Selectors instead of a full-state destructure — keeps WSA out of the
  // re-render loop when unrelated fields change.
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const contentDataSet = useWorkspaceStore((s) => s.content);
  const layouts = useWorkspaceStore((s) => s.layouts);
  const setDataSet = useWorkspaceStore((s) => s.setDataSet);
  const { saveDocument } = useDocumentStorage();
  const wsaRef = useRef<HTMLDivElement>(null);

  // Which blocks are selected. SM writes the selection snapshot into the
  // committed shape; WSA reads the block-id list straight off the store and
  // passes the flag down to each DragContainer. No SM subscription.
  //21st June -> potential fix here at some stage. WSA only one setting and subscribing.
  const selectedBlockIds = useWorkspaceStore(
    (s) => s.selection.selectedBlockIds,
  );
  const databases = useWorkspaceStore((s) => s.databases);
  const selection = useWorkspaceStore((s) => s.selection);

  // Caret target after a structural change (Enter create, Backspace delete).
  // BlockManager sets it; this component places the caret once the new DOM has
  // rendered, then clears it. selectedBlockIds is the block-highlight channel —
  // it carries no caret, so focus lives here, not there.
  const pendingFocus = useWorkspaceStore((s) => s.pendingFocus);
  const setPendingFocus = useWorkspaceStore((s) => s.setPendingFocus);

  // needs to be renamed into a named function to describe intent not just useLayoutEffect.
  useLayoutEffect(() => {
    // @flowmap-node workspace__focusEffect kind=function
    if (!pendingFocus) return;
    const editable = wsaRef.current?.querySelector<HTMLElement>(
      `[data-blockid="${pendingFocus.id}"][contenteditable="true"]`,
    );
    if (editable) placeCaret(editable, pendingFocus.edge);
    setPendingFocus(null);
  }, [pendingFocus, setPendingFocus]);

  // ── Commit: write the shape back, let React diff ─────────────────────────
  // If no helper changed anything the references match the store and we skip
  // the write.
  // @flowmap-node workspace__commit kind=function
  const commit = useCallback(
    (draft: DocDraft): void => {
      const ds = draft.dataSet;
      const file = ds.fileData.proposed ?? ds.fileData.currentReadOnly;
      const state = useWorkspaceStore.getState();
      if (!file || !state.files) return;

      const docChanged =
        ds.contentData.proposed !== null ||
        ds.layoutData.proposed !== null ||
        ds.databaseData.proposed !== null ||
        ds.fileData.proposed !== null;

      const sel = draft.selection;
      const selectionChanged =
        sel.proposedBlocks !== null ||
        sel.caret.proposedBlockId !== null ||
        sel.caret.proposedOffset !== null;

      if (!docChanged && !selectionChanged) return;

      const caretBlockId =
        sel.caret.proposedBlockId ?? sel.caret.currentBlockId;
      const nextSelection: SelectionSnapshot = {
        selectedBlockIds: sel.proposedBlocks ?? sel.currentBlocks,
        caret:
          caretBlockId !== null
            ? {
                blockId: caretBlockId,
                offset:
                  sel.caret.proposedOffset ?? sel.caret.currentOffset ?? 0,
              }
            : null,
      };

      if (!docChanged) {
        state.setSelection(nextSelection);
        return;
      }

      const content = ds.contentData.proposed ?? ds.contentData.currentReadOnly;
      const layout = ds.layoutData.proposed ?? ds.layoutData.currentReadOnly;
      const database =
        ds.databaseData.proposed ?? ds.databaseData.currentReadOnly;

      const updatedFiles: FilesDataSet = {
        ...state.files,
        [file.id]: file,
      };
      saveDocument(updatedFiles, content, layout, database);
      setDataSet(updatedFiles, content, layout, database);
      state.setActiveFile(file);
      state.setSelection(nextSelection);
    },
    [saveDocument, setDataSet],
  );

  // ── The conduit: one router, one uniform shape, every helper ─────────────
  // WSA reads its rendered store state into a DocShape, threads it through
  // every helper in a fixed order, and commits whatever comes out. WSA makes
  // NO decisions.
  // @flowmap-node workspace__route kind=function
  const route = useCallback(
    (
      channel: "mouse" | "key" | "lifecycle",
      data: MouseEventData | KeyEventData | LifecycleEventData,
      trigger: TriggerWord,
    ): void => {
      if (!contentDataSet) return;

      const nativeEvent = "nativeEvent" in data ? data.nativeEvent : null;

      // @flowmap-node workspace__buildDraft kind=function
      let draft: DocDraft = buildDraft(
        activeFile,
        contentDataSet,
        layouts ?? {},
        databases ?? {},
        selection,
        {
          event: nativeEvent,
          data,
          targetId: data.blockId,
          triggerWord: trigger,
        },
      );

      if (channel === "mouse") {
        draft = bm.receiveMouseEvent(draft);
        draft = sm.receiveMouseEvent(draft);
        draft = dm.receiveMouseEvent(draft);
        draft = lm.receiveMouseEvent(draft);
      } else if (channel === "key") {
        draft = bm.receiveKeyEvent(draft);
        draft = sm.receiveKeyEvent(draft);
        draft = dm.receiveKeyEvent(draft);
        draft = lm.receiveKeyEvent(draft);
      } else {
        draft = bm.receiveLifecycleEvent(draft);
        draft = sm.receiveLifecycleEvent(draft);
        draft = dm.receiveLifecycleEvent(draft);
        draft = lm.receiveLifecycleEvent(draft);
      }

      commit(draft);
    },
    [
      activeFile,
      contentDataSet,
      layouts,
      databases,
      selection,
      bm,
      sm,
      dm,
      lm,
      commit,
    ],
  );

  // ── Hand the workspace element to the helpers that query the DOM ─────────
  //19th June -> need to check as these might be redundant now that everything flows back through WSA.
  useEffect(() => {
    sm.setWorkspaceEl(wsaRef.current);
    dm.setWorkspaceEl(wsaRef.current);
  }, [sm, dm]);

  // ── Document-level mouse move/up bridge (see hook for why on document) ────
  // The bridge forwards those two triggers straight into the same router.

  // @flowmap-node workspace__forwardMouse kind=function
  const forwardMouse = useCallback(
    (data: MouseEventData, trigger: TriggerWord) => route("mouse", data, trigger),
    [route],
  );
  useWorkspacePointerBridge(forwardMouse);

  // ── Sibling-panel mouse bridge (LeftPanel reaches the router across the gap) ─
  // A panel click can't bubble to the workspace div, so LeftPanel dispatches its
  // mouse gesture through a store; this hook registers WSA's same router as the
  // handler. WSA stays the sole router — the panel insert flows through the same
  // route('mouse', …) every canvas click uses. WSA imports the hook, never the
  // store, so the conduit rule holds.
  usePanelEventBridge(forwardMouse);

  // ── Thin DOM-event adapters: shape the native event, hand to the router ──
  // No logic beyond shaping. A block's own handlers fire with that block's id;
  // the workspace root fires for canvas evxents.

  // @flowmap-node workspace__onMouse kind=function
  const handleMouseEvent = useCallback(
    (data: MouseEventData, trigger: TriggerWord) => route("mouse", data, trigger),
    [route],
  );

  // @flowmap-node workspace__onKey kind=function
  const handleKeyEvent = useCallback(
    (data: KeyEventData, trigger: TriggerWord) => route("key", data, trigger),
    [route],
  );

  // @flowmap-node workspace__onLife kind=function
  const handleLifecycleEvent = useCallback(
    (data: LifecycleEventData, trigger: TriggerWord) =>
      route("lifecycle", data, trigger),
    [route],
  );

  const handleWorkspaceMouseEvent = (e: React.MouseEvent, trigger: TriggerWord) => {
    handleMouseEvent(mouseEventDataFrom(e), trigger);
  };

  // Background click → "workspace-area-mouse-click" tagged with the active file id. The
  // target guard is DOM event routing (this handler owns only the canvas, not
  // its children), not a gesture decision — BlockManager owns the create guards.
  // @flowmap-node workspace__onWsClick kind=function
  const handleWorkspaceClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const fileId = useWorkspaceStore.getState().activeFile?.id ?? "";
    // Convert the viewport click into content space here (the conduit's job is
    // to package a uniform shape) so BlockManager can place the new block
    // without reading the DOM.
    const canvas = wsaRef.current;
    const rect = canvas?.getBoundingClientRect();
    const contentX = rect
      ? e.clientX - rect.left + canvas!.scrollLeft
      : e.clientX;
    const contentY = rect
      ? e.clientY - rect.top + canvas!.scrollTop
      : e.clientY;
    handleMouseEvent(
      { ...mouseEventDataFrom(e), blockId: fileId, contentX, contentY },
      "workspace-area-mouse-click",
    );
  };

  // Resolve roots only when the document is loaded. The workspace <div> ALWAYS
  // renders so wsaRef attaches on first commit.
  // @flowmap-node workspace__renderBlocks kind=function
  const roots: TextElement[] =
    activeFile && contentDataSet
      ? buildRoots(
          activeFile.content.map((id) => contentDataSet[id]).filter(Boolean),
        )
      : [];

  return (
    <div
      className="workspace-area"
      ref={wsaRef}
      onMouseDown={(event) =>
        handleWorkspaceMouseEvent(event, "workspace-area-mouse-down")
      }
      onClick={handleWorkspaceClick}
    >
      {roots.length === 0 && <WorkspaceEmptyState />}

      {contentDataSet &&
        roots.map((node) => {
          const ComponentToRender = COMPONENT_REGISTRY[node.component];
          const isSelected = selectedBlockIds.includes(node.id);
          return (
            <DragContainer
              key={node.id}
              id={node.id}
              layoutData={
                activeFile
                  ? layouts?.[layoutKey(activeFile.id, node.id)]
                  : undefined
              }
              isSelected={isSelected}
              dm={dm}
              cbMouseEvent={handleMouseEvent}
            >
              <ComponentToRender
                contentDataSet={contentDataSet}
                activeContent={node}
                cbMouseEvent={handleMouseEvent}
                cbKeyboardEvent={handleKeyEvent}
                cbLifecycleEvent={handleLifecycleEvent}
              />
            </DragContainer>
          );
        })}
    </div>
  );
}
