// ── databaseFactory ─────────────────────────────────────────────────────────
// Pure builders for a new database. BlockManager calls makeDatabaseConfig when
// it inserts a "DatabaseArea" block; the helper returns BOTH the configuration
// (schema + seed row + view state) and the cell blocks that configuration
// points at. The cells are ordinary TextElement records — BlockManager folds
// them into ContentDataSet so each cell edits through the same contentEditable
// path as every other block. No DOM, no store, no side effects here.

import { makeTextElement } from '../../../types/types'
import type {
    DatabaseConfiguration,
    DbColumn,
    RowData,
    TextElement,
} from '../../../types/types'


// Height a fresh database block occupies before its real rendered height is
// measured. One header row + one seed row, padded — measuredBlockHeight will
// replace this from the live DOM on the next layout pass.
export const DB_BLOCK_DEFAULT_H = 120

// Two starter columns so a new database is usable immediately. `key` is the
// stable id RowData.cells maps against; `name` is the editable header label.
const SEED_COLUMNS: DbColumn[] = [
    { key: 'col-name',   name: 'Name',   type: 'text' },
    { key: 'col-status', name: 'Status', type: 'text' },
]

// Default px width applied to every seed column in the database's internal
// layout. Per-column resizing writes back into DbLayoutData.columnWidths later.
const SEED_COLUMN_WIDTH = 200


// One empty cell block. A cell is a TextElement with no special component — it
// renders through ContentArea like any other text block, so selection, caret
// and editing all work unchanged. parentId points at the database block so a
// future nesting/cleanup pass can find a database's cells from the content side.
function makeCellBlock(databaseBlockId: string): TextElement {
    // Default block shape lives in makeTextElement (types.ts); a cell overrides
    // only its db-cell styling and its parent (the database block).
    return makeTextElement({ classNames: 'db-cell', parentId: databaseBlockId })
}


// Build a database configuration plus the cell blocks it points at.
//   databaseBlockId — the DatabaseArea block's id; the config is keyed by it.
// Returns:
//   config     — the DatabaseConfiguration to drop into DatabaseDataSet
//   cellBlocks — the seed row's cell TextElements to drop into ContentDataSet
export function makeDatabaseConfig(databaseBlockId: string): {
    config: DatabaseConfiguration,
    cellBlocks: TextElement[],
} {
    // One seed row: a fresh cell block per column, mapped by column key.
    const cellBlocks: TextElement[] = []
    const cells: Record<string, string> = {}
    for (const column of SEED_COLUMNS) {
        const cell = makeCellBlock(databaseBlockId)
        cellBlocks.push(cell)
        cells[column.key] = cell.id
    }

    const rowId = crypto.randomUUID()
    const row: RowData = { id: rowId, cells }

    const columnWidths: Record<string, number> = {}
    for (const column of SEED_COLUMNS) columnWidths[column.key] = SEED_COLUMN_WIDTH

    const config: DatabaseConfiguration = {
        id: databaseBlockId,
        name: 'Untitled Database',
        columns: SEED_COLUMNS.map(c => ({ ...c })),
        rows: { [rowId]: row },
        rowOrder: [rowId],
        layout: { x: 0, y: 0, w: 0, h: 0, columnWidths },
        // sort / filters left undefined — no configured view yet.
    }

    return { config, cellBlocks }
}


// Build one empty row for an existing database: a fresh cell block per column,
// plus the RowData that maps column keys to those cell ids. The caller appends
// row.id to rowOrder and folds cellBlocks into ContentDataSet. Pure.
export function makeDatabaseRow(columns: DbColumn[], databaseBlockId: string): {
    row: RowData,
    cellBlocks: TextElement[],
} {
    const cellBlocks: TextElement[] = []
    const cells: Record<string, string> = {}
    for (const column of columns) {
        const cell = makeCellBlock(databaseBlockId)
        cellBlocks.push(cell)
        cells[column.key] = cell.id
    }
    const row: RowData = { id: crypto.randomUUID(), cells }
    return { row, cellBlocks }
}
