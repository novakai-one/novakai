// @flowmap-node storage kind=service
import type { DataSet, FilesDataSet, ContentDataSet, LayoutDataSet, DatabaseDataSet } from "../types/types"
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
// WITHOUT a network round-trip.
//
// Persistence is now a plain module, not a hook. BlockManager (a non-React
// class) commits documents, so save/load can't live behind useCallback. The
// debounce timer is module-level too — ONE timer for the whole app, so a
// content save and a layout save can't race on separate per-hook timers.
// useDocumentStorage() stays as a thin wrapper for the components that still
// prefer hook ergonomics (App, LeftPanel).
let cachedDoc: DataSet | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// @flowmap-node storage__userId kind=function
async function currentUserId(): Promise<string | null> {
    const { data } = await supabase.auth.getSession()
    return data.session?.user.id ?? null
}

// Normalise a raw document object (from jsonb) into a DataSet, applying the same
// invariants the old localStorage loader did.
// @flowmap-node storage__normalise kind=function
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

    // databases is newer still — default to {} so docs saved before the database
    // block existed load without it.
    const databases: DatabaseDataSet = raw.databases ?? {}

    return { files: filesById, content: raw.content, layouts, databases }
}

// @flowmap-node storage__load kind=function
export async function loadDocument(): Promise<DataSet | null> {
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
}


// Upsert the whole document row. onConflict user_id means: insert if it's the
// user's first save, otherwise update only the `document` column — the `theme`
// column is left untouched.
// @flowmap-node storage__write kind=function
async function writeDocument(doc: DataSet): Promise<void> {
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
}


// Schedule a single debounced write — last-write-wins.
// @flowmap-node storage__schedule kind=function
function scheduleWrite(doc: DataSet): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { void writeDocument(doc) }, DEBOUNCE_MS)
}


// @flowmap-node storage__save kind=function
export function saveDocument(
    files: FilesDataSet,
    content: ContentDataSet,
    layouts: LayoutDataSet,
    databases: DatabaseDataSet,
): void {
    scheduleWrite({ files, content, layouts, databases })
}


// Content-only save — merges new content with the latest known files/layouts.
// Reads from cachedDoc (updated by every load/write) rather than the network,
// so an in-flight saveDocument's files map isn't clobbered by a stale one.
// @flowmap-node storage__saveContent kind=function
export function saveContentData(content: ContentDataSet): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
        if (!cachedDoc) return
        void writeDocument({
            files: cachedDoc.files,
            content,
            layouts: cachedDoc.layouts,
            databases: cachedDoc.databases,
        })
    }, DEBOUNCE_MS)
}


// @flowmap-node storage__clear kind=function
export async function clearDocument(): Promise<void> {
    const uid = await currentUserId()
    if (!uid) return
    cachedDoc = null
    const { error } = await supabase
        .from("workspaces")
        .update({ document: null, updated_at: new Date().toISOString() })
        .eq("user_id", uid)
    if (error) console.error("Failed to clear the document:", error)
}


// Thin wrapper for components that still call the hook (App, LeftPanel). Returns
// the module-level functions; they're stable, so this is safe in effect deps.
// @flowmap-node storage__hook kind=function
export function useDocumentStorage() {
    return { saveDocument, saveContentData, loadDocument, clearDocument }
}
