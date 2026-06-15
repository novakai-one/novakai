import PanelHeader from "../panel-header/PanelHeader"
import PanelBody from "../panel-body/PanelBody"
import './panel.css'
import { useState } from "react"
import PanelToggle from "../panel-toggle/PanelToggle"
import { useWorkspaceStore } from "../../../store/useWorkspaceStore"
import type { PanelTile, FileData } from '../../../../types/types'
import SelectionManager from "../../../../selection/selectionManager/SelectionManager"

export interface PanelProps {
    cn: string,
    panelData: PanelTile[]
    sm: SelectionManager
}

export default function Panel({ cn, panelData: pd, sm }: PanelProps) {

    const { setActiveFile } = useWorkspaceStore()

    const tileNames: string[] = pd.map(panel => panel.tileName)

    //set first tile option (files) as the selected tile (i.e. this is home page on load)
    const [selectedTile, setSelectedTile] = useState<string>(tileNames[0])
    const [panelOpen, setPanelOpen] = useState<boolean>(true)
    const [selectedBodyItem, setSelectedBodyItem] = useState<string>("")

    //using names works for now - migrate to ids once that is all set up.
    const handleTileClicked = (tileName: string) => setSelectedTile(tileName)
    const handleToggleClick = () => setPanelOpen(prev => !prev)

    const selectedPanelTile = pd.find(item => item.tileName === selectedTile)
    if (!selectedPanelTile) return null

    // ## The array list of options e.g. list of files or list of block options.
    const panelBody: string[] = selectedPanelTile.type === "files"
        ? selectedPanelTile.panelBody.map(f => f.fileName)
        : selectedPanelTile.panelBody.map(b => b.block)

    // User selects on one of the menu options e.g. a specific file or a block type.
    const handleBodyItemClick = (name: string) => {
        setSelectedBodyItem(name)
        if (selectedPanelTile.type === "files") {
            const file: FileData | undefined = selectedPanelTile.panelBody.find(f => f.fileName === name)
            if (file) setActiveFile(file)
        }
    }

    return (
        <div className={`panel ${cn} panel-open-${panelOpen}`}>
            <div className="left-panel-header-container">
                <PanelToggle
                    cn={cn}
                    handleClick={handleToggleClick}
                    panelOpen={panelOpen}
                />
                <PanelHeader
                    cn={cn}
                    panelOpen={panelOpen}
                    tileNames={tileNames}
                    handleTileClicked={handleTileClicked}
                    selectedTile={selectedTile}
                />
            </div>
            <PanelBody
                cn={cn}
                panelSubItem={panelBody}
                selectedBodyItem={selectedBodyItem}
                handleBodyItemClick={handleBodyItemClick}
            />
        </div>
    )
}