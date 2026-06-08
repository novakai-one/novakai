import './panel-body.css'
import PanelBodyItem from './PanelBodyItem';
import { useState } from 'react';

interface PanelBodyProps{
    cn: string;
    panelSubItem: string[]
}
export default function PanelBody({cn, panelSubItem}: PanelBodyProps){

    const [selectedItem, setSelectedItem] = useState<string>("");
    const handleClick = (name: string) => {
        setSelectedItem(name);
        console.log(name)
    }

//item is the content - the name of teh submenu user will click on.
// panelBodySubItem is the array of sub menus

    return (

        <div className={`${cn} panel-body`}>          
            {panelSubItem.map((item, i) => {
                return <PanelBodyItem 
                cn={cn}
                cn2={i}
                isSelected={item==selectedItem}
                handleClick={handleClick}>
                    {item}
                </PanelBodyItem>
            }
            )}
        </div>
    )
}