import { useState } from "react"
import PanelHeader from "../panel-header/PanelHeader"
import PanelBody from "../panel-body/PanelBody"
import { useWorkspaceStore } from "../../../store/useWorkspaceStore"
import type { PanelTile, FileData, BlockSpec } from '../../../../types/types'
import './panel.css'

export interface PanelProps {
    cn: string,
    panelData: PanelTile[],
    // Open/closed is owned by the layout store and passed down — the toggle now
    // lives in the header, not inside the panel.
    open: boolean,
    // Optional — when provided AND the Files tile is selected, the panel shows a
    // "new file" action. Kept optional so other panels stay unchanged.
    onAddFile?: () => void,
    // Called when a block is clicked under the Blocks tile — inserts it into the
    // active file. Provided by LeftPanel.
    onInsertBlock?: (spec: BlockSpec) => void,
}

// @flowmap-node panelChrome kind=component
export default function Panel({ cn, panelData, open, onAddFile, onInsertBlock }: PanelProps) {

    const setActiveFile = useWorkspaceStore(s => s.setActiveFile)

    const tileNames: string[] = panelData.map(panel => panel.tileName)

    // First tile (Files) is selected by default — this is the home view on load.
    const [selectedTile, setSelectedTile] = useState<string>(tileNames[0])
    const [selectedBodyItem, setSelectedBodyItem] = useState<string>("")

    const handleTileClicked = (tileName: string) => setSelectedTile(tileName)

    const selectedPanelTile = panelData.find(item => item.tileName === selectedTile)
    if (!selectedPanelTile) return null

    // The list of body items rendered under the selected tile (file names or block names).
    const panelBody: string[] = selectedPanelTile.type === "files"
        ? selectedPanelTile.panelBody.map(f => f.fileName)
        : selectedPanelTile.panelBody.map(b => b.block)

    // Body click — activates a file (Files tile) or inserts a block (Blocks tile).
    const handleBodyItemClick = (name: string) => {
        setSelectedBodyItem(name)
        if (selectedPanelTile.type === "files") {
            const file: FileData | undefined = selectedPanelTile.panelBody.find(f => f.fileName === name)
            if (file) setActiveFile(file)
        } else if (selectedPanelTile.type === "blocks") {
            const spec = selectedPanelTile.panelBody.find(b => b.block === name)
            if (spec && onInsertBlock) onInsertBlock(spec)
        }
    }

    return (
        <div className={`panel ${cn} panel-open-${open}`}>
            <PanelHeader
                cn={cn}
                panelOpen={open}
                tileNames={tileNames}
                handleTileClicked={handleTileClicked}
                selectedTile={selectedTile}
            />
            {open && selectedPanelTile.type === "files" && onAddFile && (
                <button
                    type="button"
                    className={`${cn} panel-add-file`}
                    onClick={onAddFile}
                >
                    <span className="panel-add-file-icon" aria-hidden="true">+</span>
                    New file
                </button>
            )}
            <PanelBody
                cn={cn}
                panelSubItem={panelBody}
                selectedBodyItem={selectedBodyItem}
                handleBodyItemClick={handleBodyItemClick}
            />
        </div>
    )
}
