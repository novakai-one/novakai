interface PanelBodyProps{
    cn: string;
}
export default function PanelBody({cn}: PanelBodyProps){

    return (
        <div className={`${cn}-body`}>
            Panel Body
        </div>
    )
}