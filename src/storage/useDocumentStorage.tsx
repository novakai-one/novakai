import type { TextElement, DataSet, FilesDataSet, ContentDataSet } from "../types/types"
import { useCallback, useRef } from "react";

const STORAGE_KEY: string = "document_v1";
const DEBOUNCE_MS = 1500


export function useDocumentStorage() {

    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // -- Save ----
    //Debounces - waits DEBOUNCE_MS after the last call before writing.

    const saveDocument = useCallback((
        files: FilesDataSet,
        content: ContentDataSet
    ): void => {
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current)
        }
        
        debounceTimer.current = setTimeout(() => {
            try {
                const doc: DataSet = {content, files}
                localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
            } catch (err) {
                console.error("Failed to save the document:", err)
            }
        }, DEBOUNCE_MS)
    }, [])

    const loadDocument = useCallback((): DataSet | null => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
            if (!raw) return null 
            const parsed = JSON.parse(raw) as Partial<DataSet>
            if(!parsed.files || !parsed.content) return null 
            return {
                files: parsed.files,
                content: parsed.content 
            }
        } catch (err) {
            console.error("Failed to load the document files:", err) 
            return null
        }
    }, [])



    
    const clearDocument = useCallback((): void => {
        localStorage.removeItem(STORAGE_KEY)
    }, [])

    return {saveDocument, loadDocument, clearDocument}

}

