//editor wraps panels & workspace 
import Middle from "./workspace/WorkspaceArea"
import LeftPanel from "./panels/left-panel/LeftPanel"
import RightPanel from "./panels/right-panel/RightPanel"
import './editor.css'

export default function Editor () {

    return(
        <div className="editor">           
            <LeftPanel />
            <Middle />
            <RightPanel />
            
        </div>
    )
}