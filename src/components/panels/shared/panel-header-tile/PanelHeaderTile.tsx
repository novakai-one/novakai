import './panel-header-tile.css'
interface PanelHeaderTileProps{
    cn: string,
    tileName: string,
    handleClick: (tileName:string) => void
    isSelected: boolean
}
export default function PanelHeaderTile({cn, tileName, handleClick, isSelected}: PanelHeaderTileProps){

    const tileClicked = () => {
        handleClick(tileName)
    }
    const selected: string = isSelected == true ? "selected-tile" : "";

    return (
        <div className={`${cn} panel-header-tile ${selected}`}
        onClick={tileClicked}>
            {tileName}
        </div>
    )
}