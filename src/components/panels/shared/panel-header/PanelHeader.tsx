import './panel-header.css'
import PanelHeaderTile from '../panel-header-tile/PanelHeaderTile';
import { useState } from 'react';
import type { PanelData } from '../panel/Panel';

interface PanelHeaderProps {
    cn: string;
    panelData: PanelData[]
    handleTileClicked: (tileName: string) => void
}

export default function PanelHeader({cn, panelData, handleTileClicked}: PanelHeaderProps){
let headerOptions: string[] = []
panelData.map((i) =>(
    headerOptions.push(i.tileName)
))

const [headerChoices, setHeaderChoices] = useState<string[]>(headerOptions)

/*
const handleTileClicked = (tileName: string) => {
    //Now tell panel which tile was clicked
}
*/

//pass in cn and tileName to each tile.
    return (
        <div className={`panel-header ${cn}-header`}>
            {headerOptions.map((o) => {
                return <PanelHeaderTile 
                    cn={cn}
                    tileName={o}
                    handleClick={handleTileClicked}
                    />
            })}
        </div>
    )
}