interface PanelHeaderTileProps{
    cn: string,
    tileName: string,
}
export default function PanelHeaderTile({cn, tileName}: PanelHeaderTileProps){

    return (
        <div className={`${cn} panel-header-tile`}>
            {tileName}
        </div>
    )
}