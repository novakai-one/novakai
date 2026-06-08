import './left-panel.css'
import Panel from '../shared/panel/Panel'
import type { PanelData } from '../shared/panel/Panel'
import CanvasArea from '../../workspace-interactives/CanvasArea'
import type { ReactComponentElement } from 'react'
//naming convention className left-panel 

//content: SubMenu[]
//SubMenu: {title: string, component: Component, workspaceData: string}


export default function LeftPanel() {
const cn: string = "left-panel"

const leftPanelData: PanelData[] = [
    {tileName: "Page",
    panelBody: [
        {title: "This is panel 1", 
        component: <CanvasArea />,
        content: "content for canvas"}]
    }, 
    {tileName: "Page 2",
    panelBody: [{title: "This is panel 2", component: <CanvasArea />, content: "content for canvas"}]}, 
    {tileName: "3",
    panelBody: [{title: "This is panel 2", component: <CanvasArea />, content: "content for canvas"}]}
]

//Next step is to create data structure so that content can be passed in to the panel data.
//Requires content to become an array of contentParts.


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