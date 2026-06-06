import PanelHeader from "../panel-header/PanelHeader"
import PanelBody from "../panel-body/PanelBody"
import './panel.css'
interface PanelProps{
    cn: string;
}
export default function Panel({cn}: PanelProps) {

    

    return (
        <div className={`panel ${cn}`}>
            <PanelHeader
                cn={cn}
            />
            <PanelBody
                cn={cn}
            />
        </div>
    )
}