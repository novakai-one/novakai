import PanelHeader from "../panel-header/PanelHeader"
import PanelBody from "../panel-body/PanelBody"
import './panel.css'
import { useState } from "react"
import PanelToggle from "../panel-toggle/PanelToggle"
import { useWorkspaceStore } from "../../../store/useWorkspaceStore"
import type { PanelPiece } from '../../../../types/types'

export interface PanelProps {
    cn: string,
    panelData: PanelPiece[]
}

export default function Panel({ cn, panelData: pd }: PanelProps) {

    const { setActiveContent } = useWorkspaceStore()

    const tileNames: string[] = pd.map(panel => panel.tileName)

    const [selectedTile, setSelectedTile] = useState<string>(tileNames[0])
    const [panelOpen, setPanelOpen] = useState<boolean>(true)
    const [selectedBodyItem, setSelectedBodyItem] = useState<string>("")

    const handleTileClicked = (tileName: string) => setSelectedTile(tileName)
    const handleToggleClick = () => setPanelOpen(prev => !prev)

    const selectedPanelData = pd.find(item => item.tileName === selectedTile)
    if (!selectedPanelData) return null

    const panelBody: string[] = selectedPanelData.kind === "files"
        ? selectedPanelData.panelBody.map(f => f.fileName)
        : selectedPanelData.panelBody.map(p => p.piece)

    const handleBodyItemClick = (name: string) => {
        setSelectedBodyItem(name)
        if (selectedPanelData.kind === "files") {
            const file = selectedPanelData.panelBody.find(f => f.fileName === name)
            if (file) setActiveContent(file)
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