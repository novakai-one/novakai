import { useCallback, useRef } from "react"
import type { DataSet, FilesDataSet, ContentDataSet, LayoutDataSet } from "../types/types"

const STORAGE_KEY = "document_v1"
const DEBOUNCE_MS = 1500


// Document persistence helpers backed by localStorage.
//
// Writes are debounced by DEBOUNCE_MS — typing storms collapse to one write,
// not one-per-keystroke. saveDocument and saveContentData share the same timer
// so the most-recent write wins (the alternative — separate timers — would let
// an older partial save land on top of a newer full save).
//
// Reads are synchronous. loadDocument is cheap (one JSON.parse) but should
// still be called from an effect, not in render.
export function useDocumentStorage() {

    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)


    const loadDocument = useCallback((): DataSet | null => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
            if (!raw) return null
            const parsed = JSON.parse(raw) as Partial<DataSet>
            if (!parsed.files || !parsed.content) return null

            // The files record MUST be keyed by FileData.id. Saving (e.g. the drop
            // handler) always writes under file.id, so any entry whose key drifts
            // from its id would be appended as a duplicate instead of overwriting.
            // Re-key by id on load so the convention is guaranteed and any existing
            // duplicate (same id under two keys) collapses to a single entry.
            const filesById: FilesDataSet = {}
            for (const file of Object.values(parsed.files)) {
                filesById[file.id] = file
            }

            // layouts is new — older saved docs won't have it. Default to {} so
            // loading a pre-split document never crashes; placements just start empty.
            const layouts: LayoutDataSet = parsed.layouts ?? {}

            return { files: filesById, content: parsed.content, layouts }
        } catch (err) {
            console.error("Failed to load the document:", err)
            return null
        }
    }, [])


    // Schedule a single debounced write — last-write-wins.
    const scheduleWrite = useCallback((doc: DataSet) => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
            } catch (err) {
                console.error("Failed to save the document:", err)
            }
        }, DEBOUNCE_MS)
    }, [])


    const saveDocument = useCallback((
        files: FilesDataSet,
        content: ContentDataSet,
        layouts: LayoutDataSet,
    ): void => {
        scheduleWrite({ files, content, layouts })
    }, [scheduleWrite])


    // Content-only save — merges new content with the currently-persisted files
    // and layouts. Reading localStorage inside the debounced timer is intentional:
    // we want the latest files/layouts snapshot at write time, not at call time,
    // so an in-flight saveDocument can't be overwritten by a stale map.
    const saveContentData = useCallback((content: ContentDataSet): void => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => {
            const stored = loadDocument()
            if (!stored) return
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    files: stored.files,
                    content,
                    layouts: stored.layouts,
                }))
            } catch (err) {
                console.error("Failed to save content:", err)
            }
        }, DEBOUNCE_MS)
    }, [loadDocument])


    const clearDocument = useCallback((): void => {
        localStorage.removeItem(STORAGE_KEY)
    }, [])


    return { saveDocument, saveContentData, loadDocument, clearDocument }
}
