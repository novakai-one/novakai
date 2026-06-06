import './panel-header.css'
import PanelHeaderTile from '../panel-header-tile/PanelHeaderTile';
import { useState } from 'react';

interface PanelHeaderProps {
    cn: string;
}

export default function PanelHeader({cn}: PanelHeaderProps){

const [headerChoices, setHeaderChoices] = useState<string[]>(["1", "2", "3"])

//pass in cn and tileName to each tile.
    return (
        <div className={`panel-header ${cn}-header`}>
            {headerChoices.map((c) => {
                return <PanelHeaderTile 
                    cn={cn}
                    tileName={c}
                    />
            })}
        </div>
    )
}