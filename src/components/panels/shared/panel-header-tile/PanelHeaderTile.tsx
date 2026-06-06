interface PanelHeaderTileProps{
    cn: string,
    tileName: string,
    handleClick: (tileName:string) => void
}
export default function PanelHeaderTile({cn, tileName, handleClick}: PanelHeaderTileProps){

    const tileClicked = () => {
        handleClick(tileName)
    }

    return (
        <div className={`${cn} panel-header-tile`}
        onClick={tileClicked}>
            {tileName}
        </div>
    )
}