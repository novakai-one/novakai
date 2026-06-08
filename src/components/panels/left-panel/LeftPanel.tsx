import './left-panel.css'
import Panel from '../shared/panel/Panel'
import type { PanelData } from '../shared/panel/Panel'
import CanvasArea from '../../workspace-interactives/CanvasArea'
//naming convention className left-panel 

export default function LeftPanel() {
const cn: string = "left-panel"

const leftPanelData: PanelData[] = [
    {tileName: "Page",
    content: ["This is panel 1", "Option 2", "Option 3", "Option 4"]},
    {tileName: "2", 
    content: ["this is panel 2"]},
    {tileName: "3",
    content: ["this is panel 3"]}
]

//Next step is to create data structure so that content can be passed in to the panel data.
//Requires content to become an array of contentParts.
const contentPart = {
    title: "this is panel 1",
    component: <CanvasArea/>
}

/*
content will be
content: {
    label: ,
    component: <Canvas>
}
*/

    return (
        <Panel 
            cn={cn}
            panelData={leftPanelData}
        />
    )
}