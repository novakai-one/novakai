import './panel-body.css'
import PanelBodyItem from './PanelBodyItem';
import { useState } from 'react';

interface PanelBodyProps{
    cn: string;
    panelSubItem: string[],
    selectedBodyItem: string,
    handleBodyItemClick: (name: string) => void
}
export default function PanelBody({cn, panelSubItem, selectedBodyItem: selectedItem, handleBodyItemClick}: PanelBodyProps){

    
    /*const handleClick = (name) => {
        handleBodyItemClick(name)
        //setSelectedItem(name);
        console.log(name)
    }*/

//item is the content - the name of teh submenu user will click on.
// panelBodySubItem is the array of sub menus

    return (

        <div className={`${cn} panel-body`}>          
            {panelSubItem.map((item, i) => {
                return <PanelBodyItem 
                cn={cn}
                cn2={i}
                isSelected={item==selectedItem}
                handleClick={handleBodyItemClick}>
                    {item}
                </PanelBodyItem>
            }
            )}
        </div>
    )
}