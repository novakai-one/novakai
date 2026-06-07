import './panel-toggle.css'
interface PanelToggleProps {
    cn: string;
    handleClick: () => void;
    panelOpen: boolean;
}
export default function PanelToggle({cn, handleClick, panelOpen}: PanelToggleProps){

    return (
        <div className={`${cn} panel-toggle panel-toggle-open-${panelOpen}`}
        onClick={handleClick}>
            ⚾︎
        </div>
    )
}