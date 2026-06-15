//editor wraps panels & workspace 
import Middle from "./workspace/WorkspaceArea"
import LeftPanel from "./panels/left-panel/LeftPanel"
import RightPanel from "./panels/right-panel/RightPanel"
import './editor.css'
import Header from "./header/Header"
import Footer from "./footer/Footer"
import WorkspaceArea from "./workspace/WorkspaceArea"
import type SelectionManager from "../selection/selectionManager/SelectionManager"
interface EditorProps {
    sm: SelectionManager
}
export default function Editor ({sm}: EditorProps) {

    return(
        <div className="editor">           
            
            <Header />
            <WorkspaceArea sm={sm}/>  
            <Footer />
            
        </div>
    )
}