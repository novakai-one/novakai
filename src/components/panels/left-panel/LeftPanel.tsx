import './left-panel.css'
import Panel from '../shared/panel/Panel'
import type { MetaData, FilePanelTile, BlockPanelTile, PanelTile, DataSet } from '../../../types/types'
import { useDocumentStorage } from '../../../storage/useDocumentStorage'

export default function LeftPanel() {
    
    const cn: string = "left-panel"
    
    const storedDataSet = useDocumentStorage().loadDocument() 
    if(!storedDataSet) return
    const {files} = storedDataSet //Record<string, FileData | ContentDataSet> -> CDS is TextElements
    
    const fileData: FilePanelTile = {
        type: "files",
        tileName: "Files",
        panelBody: Object.values(files)
    }

    //hard-coded for now until files and fileContents are working
    const blockOptions: BlockPanelTile = {
        type: "blocks",
        tileName: "Blocks",
        panelBody: [{ id: "block-1", block: "Header" }, { id: "block-2", block: "Callout" }, { id: "block-3", block: "Quote" }]
    }

    const leftPanelData: PanelTile[] = [fileData, blockOptions]

    return (
        <Panel
            cn={cn}
            panelData={leftPanelData}
        />
    )
}