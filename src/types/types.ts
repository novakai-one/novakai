
export interface MetaData{
    dateCreated: string,
    author?: string,
    lastEdited?: string
}

//layout is temp. Eventually create layoutdata type with x and y  -[]
//Tag types to add -> search, select, ul, ol, img etc. expand types -[]
//unsure if I need styles here -> I suspect I'll be able to use CSS in JS and then apply as classNames and use CSS vars.
//parent and children elements -> dom tree essentially -> lets see if I actually need it first.
//fileName? - not sure if it should havbe this - might help search - but wait til I'm there.
//the tricky thing is how do I know when to close the tags. -> if i cant add children then everything becomes a sibling.
// -> I believe number of children will solve this without adding HTML elements in an array.
export interface TextElement {
    id: string,
    component: "ContentArea",
    Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "p" | "span" | "ol" | "ul" | "li" | "div",
    styles: string,
    classNames: string,
    innerContent: string,
    layout?: string //create layoutData once relevant.
    //parent and child 
    parentId: string | null //this would tell me if the next element is a sibling or child.,
    children: string[] | null //TextElement[] | null - 
    files: string[]
}
//Record<DataSet, DataType>



export interface PiecesPanelData{
    tileName: "Pieces",
    panelBody: {
        id: string,
        piece: string
    }[]
}

export type PanelTile = FilePanelTile | BlockPanelTile;

export interface FilePanelTile {
    type: "files",
    tileName: "Files",
    panelBody: FileData[]
}

export interface BlockPanelTile {
    type: "blocks",
    tileName: "Blocks",
    panelBody: { id: string, block: string }[]
}

export type ContentDataSet = Record<string, TextElement>

export type FilesDataSet = Record<string, FileData>

export type FileData = {
    id: string,
    metaData: MetaData,
    tags: string[]
    fileName: string,
    content: string[] // the lookup for content dataSet database
}

export type DataSet = {
    files: FilesDataSet,
    content: ContentDataSet
}