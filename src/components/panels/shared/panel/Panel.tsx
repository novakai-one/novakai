import PanelHeader from "../panel-header/PanelHeader"
import PanelBody from "../panel-body/PanelBody"
import './panel.css'
import { useState } from "react"
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
    
    const [panelData, setPanelData] = useState<PanelData[]>(pd)

    //now map through panelData and pass the header into header and content into body
    

    //needs an onclick callback sent down to Header.
    const handleTileClicked = (tileName: string) => {
        //do something
    }
    

    return (
        <div className={`panel ${cn}`}>
            
            <PanelHeader
                cn={cn}
                panelData={pd}
                handleTileClicked={handleTileClicked}
            />
            <PanelBody
                cn={cn}
            />
        </div>
    )
}