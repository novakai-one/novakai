import PanelHeader from "../panel-header/PanelHeader"
import PanelBody from "../panel-body/PanelBody"
import './panel.css'
import { useState } from "react"
import PanelToggle from "../panel-toggle/PanelToggle"
interface PanelProps{
    cn: string,
    panelData: PanelData[]
}
export interface PanelData {
    tileName: string,
    content: string
    //[tileName: string]: {content: string}
}
export default function Panel({cn, panelData: pd}: PanelProps) {
    //Panel needs state storage for tileName & bodyContent
    //key: value name: "content"
    //left-panel -> passes stored info to Panel (non-stateful) -> puts it into state
    //pd passed down as non stateful and then stored into state.
    
    

    //now map through panelData and pass the header into header and content into body
    

    //needs an onclick callback sent down to Header.
    const handleTileClicked = (tileName: string) => {
        setSelectedTile(tileName);
    }

    //tileNames
    const [panelData, setPanelData] = useState<PanelData[]>(pd)
    const tileNames: string[] = Array.from(panelData, panel => panel.tileName);
       
    const [selectedTile, setSelectedTile] = useState(tileNames[0]);
    console.log(selectedTile)
    console.log("here")
    //Tell panelHeader who the selected tile is as the start.
    //Pass that info to panel body.

    
    const selectedPanelData = panelData.find((item) => item.tileName==selectedTile)
    if(!selectedPanelData) return 
    const panelBody = selectedPanelData.content;

    //might need to be a ref -> unsure at this stage -> not sure if it'll cause some css clash
    const [panelOpen, setPanelOpen] = useState<boolean>(true);
    const handleToggleClick = () => {
        setPanelOpen(!panelOpen);
        console.log(panelOpen)
    }


    return (
    <div className={`panel ${cn} panel-open-${panelOpen}`}>
            
            <div>
                <PanelToggle 
                        cn={cn}
                        handleClick={handleToggleClick}
                        panelOpen={panelOpen}
                    />
                <PanelHeader
                    cn={cn}
                    tileNames={tileNames}
                    handleTileClicked={handleTileClicked}
                    selectedTile={selectedTile}
                />
                
            </div>
            <PanelBody
                cn={cn}
                content={panelBody}
            />
        </div>
    )
}