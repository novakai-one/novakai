import './panel-body-item.css'
interface PanelBodyItemProps{
    cn: string,
    cn2: number,
    children: string,
    isSelected: boolean,
    handleClick: (name: string) => void
}
export default function PanelBodyItem({cn, cn2, children, isSelected, handleClick: onClickCallback}: PanelBodyItemProps){
const handleClick = () => {
    onClickCallback(children)
}

    return (
        <div className={`${cn} panel-body-item-${cn2} ${isSelected?"isSelected":""}`}
        onClick={handleClick}>
            {children}
        </div>
    )
}