import './panel-header.css'
interface PanelHeaderProps {
    cn: string;
}

export default function PanelHeader({cn}: PanelHeaderProps){

    return (
        <div className={`panel-header ${cn}-header`}>
            Panel Header
        </div>
    )
}