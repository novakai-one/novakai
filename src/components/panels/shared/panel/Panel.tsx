import PanelHeader from "../panel-header/PanelHeader"
import PanelBody from "../panel-body/PanelBody"
import './panel.css'
import { useState } from "react"
import PanelToggle from "../panel-toggle/PanelToggle"
export interface PanelProps{
    cn: string,
    panelData: PanelData[]
}

export interface PageContent {
    title: string,
    component: React.JSX.Element,
    content: string
}

export interface PanelData {
    tileName: string,
    panelBody: PageContent[]
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
       
    //selected panel tile for auto focus.
    const [selectedTile, setSelectedTile] = useState<string>(tileNames[0]);

    
    //auto focus on the first tile menu on load.
    const selectedPanelData = panelData.find((item) => item.tileName==selectedTile)
    if(!selectedPanelData) return 
    
    //Extract the subMenu titles in order to populate the panel body.
    const panelBody: string[] = selectedPanelData.panelBody.map((subMenu) => {return subMenu.title})

    //might need to be a ref -> unsure at this stage -> not sure if it'll cause some css clash
    const [panelOpen, setPanelOpen] = useState<boolean>(true);
    const handleToggleClick = () => {
        setPanelOpen(!panelOpen);
        console.log(panelOpen)
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
            />
        </div>
    )
}