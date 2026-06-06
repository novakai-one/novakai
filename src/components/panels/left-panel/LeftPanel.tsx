import './left-panel.css'
import Panel from '../shared/panel/Panel'
//naming convention className left-panel 

export default function LeftPanel() {
const cn: string = "left-panel"

    return (
        <Panel 
            cn={cn}
        />
    )
}