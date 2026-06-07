interface PanelBodyProps{
    cn: string;
    content: string
}
export default function PanelBody({cn, content}: PanelBodyProps){

    return (
        <div className={`${cn}-body`}>
            {content}
        </div>
    )
}