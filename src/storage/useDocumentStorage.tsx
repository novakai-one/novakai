import { useCallback, useRef } from "react"
import type { DataSet, FilesDataSet, ContentDataSet, LayoutDataSet } from "../types/types"
import { supabase } from "../lib/supabase"

const DEBOUNCE_MS = 1500

// Document persistence — now backed by Supabase instead of localStorage.
//
// One row per user in the `workspaces` table; the document lives in the
// `document` jsonb column. Row-level security guarantees a user only ever
// touches their own row, so every query is implicitly scoped to auth.uid().
//
// Async vs sync: localStorage reads were synchronous; the network isn't.
// loadDocument now returns a Promise — App.tsx awaits it in its mount effect.
// The save functions stay fire-and-forget (debounced void), exactly as before,
// so WorkspaceArea didn't have to change.
//
// cachedDoc is a module-level snapshot of the last document we read or wrote.
// It lets saveContentData merge new content with the current files/layouts
// WITHOUT a network round-trip, and is shared across every hook instance
// (the old code leaned on localStorage being shared the same way).
let cachedDoc: DataSet | null = null

async function currentUserId(): Promise<string | null> {
    const { data } = await supabase.auth.getSession()
    return data.session?.user.id ?? null
}

// Normalise a raw document object (from jsonb) into a DataSet, applying the same
// invariants the old localStorage loader did.
function normalise(raw: Partial<DataSet> | null): DataSet | null {
    if (!raw || !raw.files || !raw.content) return null

    // files MUST be keyed by FileData.id. Re-key on load so any entry whose key
    // drifted from its id collapses onto the canonical id instead of duplicating.
    const filesById: FilesDataSet = {}
    for (const file of Object.values(raw.files)) {
        filesById[file.id] = file
    }

    // layouts is newer than the original schema — default to {} so older docs load.
    const layouts: LayoutDataSet = raw.layouts ?? {}

    return { files: filesById, content: raw.content, layouts }
}

export function useDocumentStorage() {

    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)


    const loadDocument = useCallback(async (): Promise<DataSet | null> => {
        try {
            const uid = await currentUserId()
            if (!uid) return null

            const { data, error } = await supabase
                .from("workspaces")
                .select("document")
                .eq("user_id", uid)
                .maybeSingle()

            if (error) throw error

            const doc = normalise((data?.document as Partial<DataSet>) ?? null)
            cachedDoc = doc
            return doc
        } catch (err) {
            console.error("Failed to load the document:", err)
            return null
        }
    }, [])


    // Upsert the whole document row. onConflict user_id means: insert if it's the
    // user's first save, otherwise update only the `document` column — the `theme`
    // column is left untouched.
    const writeDocument = useCallback(async (doc: DataSet): Promise<void> => {
        const uid = await currentUserId()
        if (!uid) return
        const { error } = await supabase
            .from("workspaces")
            .upsert(
                { user_id: uid, document: doc, updated_at: new Date().toISOString() },
                { onConflict: "user_id" },
            )
        if (error) console.error("Failed to save the document:", error)
        else cachedDoc = doc
    }, [])


    // Schedule a single debounced write — last-write-wins.
    const scheduleWrite = useCallback((doc: DataSet) => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => { void writeDocument(doc) }, DEBOUNCE_MS)
    }, [writeDocument])


    const saveDocument = useCallback((
        files: FilesDataSet,
        content: ContentDataSet,
        layouts: LayoutDataSet,
    ): void => {
        scheduleWrite({ files, content, layouts })
    }, [scheduleWrite])


    // Content-only save — merges new content with the latest known files/layouts.
    // Reads from cachedDoc (updated by every load/write) rather than the network,
    // so an in-flight saveDocument's files map isn't clobbered by a stale one.
    const saveContentData = useCallback((content: ContentDataSet): void => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => {
            if (!cachedDoc) return
            void writeDocument({
                files: cachedDoc.files,
                content,
                layouts: cachedDoc.layouts,
            })
        }, DEBOUNCE_MS)
    }, [writeDocument])


    const clearDocument = useCallback(async (): Promise<void> => {
        const uid = await currentUserId()
        if (!uid) return
        cachedDoc = null
        const { error } = await supabase
            .from("workspaces")
            .update({ document: null, updated_at: new Date().toISOString() })
            .eq("user_id", uid)
        if (error) console.error("Failed to clear the document:", error)
    }, [])


    return { saveDocument, saveContentData, loadDocument, clearDocument }
}
