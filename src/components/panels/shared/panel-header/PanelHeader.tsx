import './panel-header.css'
import PanelHeaderTile from '../panel-header-tile/PanelHeaderTile';
import { useState } from 'react';
import type { PanelData } from '../panel/Panel';
import PanelToggle from '../panel-toggle/PanelToggle';


interface PanelHeaderProps {
    cn: string,
    panelOpen: boolean,
    tileNames: string[]
    handleTileClicked: (tileName: string) => void
    selectedTile: string;
}

export default function PanelHeader({cn, panelOpen, tileNames, handleTileClicked, selectedTile}: PanelHeaderProps){

/*
const handleTileClicked = (tileName: string) => {
    //Now tell panel which tile was clicked
}
*/
//focus on selected tile.
console.log(selectedTile)

//pass in cn and tileName to each tile.
    return (
        <div className={`panel-header ${cn}-header panel-open-${panelOpen}`}>
            {tileNames.map((tileName) => {
                return <PanelHeaderTile 
                    cn={cn}
                    tileName={tileName}
                    handleClick={handleTileClicked}
                    isSelected={tileName==selectedTile}
                    />
            })}
        </div>
    )
}