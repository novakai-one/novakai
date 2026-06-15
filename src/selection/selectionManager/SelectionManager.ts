
export class SelectionPoint {
    //can I place it via x and y -> when i move to absolute positioning.
    blockType: string = "";
    blockId: string = "";
    childNodeIndex: number = 0;
    node: Text | HTMLBRElement | null = null;
    startOffset: number = 0;
    endOffset: number = 0;
}

export type SelectionParams = {
    blockType: string, //will need to be typed properly to Component Registry
    blockId: string,
    childNodeIndex: number,
    node: Text | HTMLBRElement | null,
    startOffset: number,
    endOffset: number,
}

export type CaretPointParams = {
    blockType: string,
    blockId: string,
    childNodeIndex: number,
    node: Text | HTMLBRElement,
    caretOffset: number
}

export class CaretPoint {
    blockType: string = "";
    blockId: string = "";
    childNodeIndex: number = 0;
    node: Text | HTMLBRElement | null = null;
    caretOffset: number = 0;
}

export default class SelectionManager{

    //anchor and focus node -> important for highlighting.
    //but for caret Pos do I actually need to store the node.
    //It creates one less field to maintain at least.

    anchor: SelectionPoint = new SelectionPoint();
    focus: SelectionPoint = new SelectionPoint();
    caretPos: CaretPoint = new CaretPoint();

   

    receiveMouseEvent = (caretPos: CaretPointParams) => {
        this._storeCaretPosition(caretPos);
    }

    //childNodeIndex: number, node: Text | HTMLBrElement startOffset: number, endOffset: number
    private _storeCaretPosition = ({
        blockType, blockId, childNodeIndex, node, caretOffset}: CaretPointParams  
    ): void => {
        //When re-rendering I will be able to find blockId, then get to the childNode and then place offset.
        const caretPosition: CaretPoint = {
            blockType,
            blockId,
            childNodeIndex,
            node,
            caretOffset
        }
        this.caretPos = caretPosition;     
    }

    focusCaret = () => {
        const node = this.caretPos.node
        if(!node) return
        node.normalize();
        const offset = this.caretPos.caretOffset
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset)
        range.collapse();
    
        const browserSelection = window.getSelection()
        browserSelection?.removeAllRanges();
        browserSelection?.addRange(range);
    }

    //Maybe SM can focus the caret.
    
    /* This will need to go into the sm and workspace area to focus the caret.
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 0)
    range.collapse();
    console.dir(range)

    const browserSelection = window.getSelection()
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    */
}