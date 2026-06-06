import './left-panel.css'
import Panel from '../shared/panel/Panel'
import type { PanelData } from '../shared/panel/Panel'
//naming convention className left-panel 

export default function LeftPanel() {
const cn: string = "left-panel"

const leftPanelData: PanelData[] = [
    {tileName: "Page",
    content: "This is panel 1"},
    {tileName: "2",
     content: "this is panel 2"},
    {tileName: "3",
    content: "this is panel 3"}
]

    return (
        <Panel 
            cn={cn}
            panelData={leftPanelData}
        />
    )
}