import "./left-panel.css";
import Panel from "../shared/panel/Panel";
import type {
  FilePanelTile,
  BlockPanelTile,
  PanelTile,
  BlockSpec,
  FileData,
  FilesDataSet,
  MouseEventData,
} from "../../../types/types";
import { useWorkspaceStore } from "../../../components/store/useWorkspaceStore";
import { useBlockEventStore } from "../../../components/store/useBlockEventStore";
import { useLayoutStore } from "../../../managers/layout/store/useLayoutStore";
import { useDocumentStorage } from "../../../storage/useDocumentStorage";
import { BLOCK_DEFINITIONS } from "../../../managers/blockManager/blockDefinitions";

// The Blocks tile lists the shared insertable-block catalog — BlockManager reads
// the same catalog to build whichever one is clicked, so the two never drift.
const BLOCK_OPTIONS: BlockPanelTile = {
  type: "blocks",
  tileName: "Blocks",
  panelBody: BLOCK_DEFINITIONS,
};

// A panel block click is a mouse gesture that originates outside the workspace
// element. It rides the same mouse channel every canvas click uses; this trigger
// (see trigger-words.ts) tells BlockManager to insert the carried block.
const PANEL_BLOCK_TRIGGER = "left-panel-block-mouse-click";

// File names double as PanelBody keys + click lookups, so a new file needs a
// name no existing file already uses. "Untitled", then "Untitled 2", "3", …
function uniqueFileName(files: FilesDataSet): string {
  const taken = new Set(Object.values(files).map((f) => f.fileName));
  if (!taken.has("Untitled")) return "Untitled";
  let n = 2;
  while (taken.has(`Untitled ${n}`)) n++;
  return `Untitled ${n}`;
}

export default function LeftPanel() {
  // Subscribe to files via selector so unrelated store updates don't re-render.
  const files = useWorkspaceStore((s) => s.files);
  const setDataSet = useWorkspaceStore((s) => s.setDataSet);
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile);
  const leftPanelOpen = useLayoutStore((s) => s.leftPanelOpen);
  const { saveDocument } = useDocumentStorage();

  const fileData: FilePanelTile = {
    type: "files",
    tileName: "Files",
    panelBody: files ? Object.values(files) : [],
  };

  const panelData: PanelTile[] = [fileData, BLOCK_OPTIONS];

  // Create a blank file, push it into the store so it shows immediately, then
  // persist. Read content/layouts via getState() (not selectors) so adding a
  // file doesn't re-render LeftPanel on every content edit. Same pattern WSA
  // uses for its structural mutations.
  const handleAddFile = () => {
    const state = useWorkspaceStore.getState();
    const currentFiles = state.files ?? {};
    const content = state.content ?? {};
    const layouts = state.layouts ?? {};
    const databases = state.databases ?? {};

    const newFile: FileData = {
      id: crypto.randomUUID(),
      metaData: { dateCreated: new Date().toISOString() },
      tags: [],
      fileName: uniqueFileName(currentFiles),
      content: [],
    };

    const updatedFiles: FilesDataSet = {
      ...currentFiles,
      [newFile.id]: newFile,
    };

    setDataSet(updatedFiles, content, layouts, databases);
    saveDocument(updatedFiles, content, layouts, databases);
    setActiveFile(newFile);
  };

  // Insert the chosen block by shaping a mouse gesture and dispatching it into
  // WSA's router across the sibling gap. The block's identity rides in blockId
  // (the catalog id BlockManager resolves) exactly as a canvas-click rides the
  // file id there. Coordinates are unused — a panel insert drops at the bottom of
  // the canvas — so they're zeroed. WSA places it, LayoutManager tidies, WSA
  // commits: the same conduit every canvas click uses. getState().dispatch
  // reaches WSA without a re-render.
  const handleInsertBlock = (spec: BlockSpec) => {
    const gesture: MouseEventData = {
      clientX: 0,
      clientY: 0,
      blockId: spec.id,
      blockType: spec.component,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      button: 0,
      buttons: 0,
      nativeEvent: null,
    };
    useBlockEventStore.getState().dispatch(gesture, PANEL_BLOCK_TRIGGER);
  };

  return (
    <Panel
      cn="left-panel"
      panelData={panelData}
      open={leftPanelOpen}
      onAddFile={handleAddFile}
      onInsertBlock={handleInsertBlock}
    />
  );
}
