import './App.css'
import Header from './components/header/Header'
import Footer from './components/footer/Footer'
import Editor from './components/Editor'
import LeftPanel from './components/panels/left-panel/LeftPanel'
import RightPanel from './components/panels/right-panel/RightPanel'
import { useEffect } from 'react'
import type { DataSet, MetaData } from './types/types'
import { useDocumentStorage } from './storage/useDocumentStorage'
import { useWorkspaceStore } from './components/store/useWorkspaceStore'
import { SelectionPoint } from './selection/selectionManager/SelectionManager'
import SelectionManager from './selection/selectionManager/SelectionManager'

export default function App() {
  const {saveDocument, loadDocument} = useDocumentStorage();
  const { setActiveFile, setDataSet } = useWorkspaceStore();
  const ds =  loadDocument()
  useEffect(() => {
    if(!ds) return 
    const {files, content} = ds
    setDataSet(files, content)
  }, [])

  
  
  
  

  //boilerplate starting data.
      //if null use boilerplate .
const startingMetaData: MetaData = {
    dateCreated: "2026-06-09",
    author: "Chris",
    lastEdited: "2026-06-09 2:41am",
}
      
/*
const startingDataSet: DataSet = {
  content: {
      1: { id: "1", component: "ContentArea", Tag: "h1", styles: "", classNames: "title", innerContent: "My Document", parentId: null, children: null, files: ["1"] },
      2: { id: "2", component: "ContentArea", Tag: "p", styles: "", classNames: "body-text", innerContent: "This is an introductory paragraph.", parentId: null, children: null, files: ["1"]},
      3: { id: "3", component: "ContentArea", Tag: "h2", styles: "", classNames: "section-heading", innerContent: "Section One", parentId: null, children: null, files: ["1"] },
      4: { id: "4", component: "ContentArea", Tag: "p", styles: "", classNames: "body-text", innerContent: "Content under section one.", parentId: null, children: null, files: ["1"] },
      5: { id: "5", component: "ContentArea", Tag: "ul", styles: "", classNames: "list", innerContent: "", parentId: null, children: ["6", "7"], files: ["1"]},
      6: { id: "6", component: "ContentArea", Tag: "li", styles: "", classNames: "list-item", innerContent: "First item", parentId: "5", children: null, files: ["1"] },
      7: { id: "7", component: "ContentArea", Tag: "li", styles: "", classNames: "list-item", innerContent: "Second item", parentId: "5", children: null, files: ["1"] }
  },
  files: {
      1: { id: "file-1", fileName: "first file", content: ["1", "2", "3", "4", "5", "6", "7"], metaData: startingMetaData, tags: [""] }
  }
}
  */
  
  
  /*
  useEffect(() => {
    //const storedDataSet = useDocumentStorage().loadDocument()
    //going to delete anyway so may as well remove the if.
    saveDocument(startingDataSet.files, startingDataSet.content)
  }, [])
  */
 

  
  const selectionManager = new SelectionManager()

  return (
    <div className="app">
      
      <LeftPanel sm={selectionManager} />
      <Editor sm={selectionManager} />
      <RightPanel />
      
    </div>
   
  )
}
