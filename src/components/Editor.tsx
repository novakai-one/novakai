//editor wraps panels & workspace
import './editor.css'
import Header from "./header/Header"
import Footer from "./footer/Footer"
import WorkspaceArea from "./workspace/WorkspaceArea"
import type SelectionManager from "../selection/selectionManager/SelectionManager"
import type DragManager from "../draggable/dragManager/DragManager"
import type BlockManager from "./workspace-blocks/blocks/blockManager"
import type LayoutManager from "../layout/layoutManager"
interface EditorProps {
    sm: SelectionManager,
    dm: DragManager,
    bm: BlockManager,
    lm: LayoutManager
}
export default function Editor ({sm, dm, bm, lm}: EditorProps) {

    return(
        <div className="editor">           
            
            <Header />
            <WorkspaceArea 
                sm={sm}
                dm={dm}
                bm={bm}
                lm={lm}
                />  
            <Footer />
            
        </div>
    )
}