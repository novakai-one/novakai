import {
  makeTextElement,
  layoutKey,
  databaseKey,
  CHECKBOX_CHECKED,
  type DocDraft,
  type TextElement,
  type LayoutItem,
  type ContentDataSet,
  type LayoutDataSet,
  type DatabaseDataSet,
  type FileData,
  type DatabaseConfiguration,
  type DbColumn,
  type DbLayoutData,
  type RowData,
  type KeyEventData,
  type MouseEventData,
  type LifecycleEventData,
} from "../../types/types";

// BlockManager — create + delete + value edits. Scoped to block-manager.mmd.
//
// Invariants (hard):
//   - currentReadOnly is never mutated. Every read is `proposed ?? current`.
//   - Every write lands on a `proposed` slice, as a NEW object.
//   - Never touches draft.selection. Never touches the caret channel.
//   - A handler that matches nothing returns the draft unchanged.

// New-block footprint when the trigger has no placement (first block / panel
// insert into empty canvas). When a trigger placement exists, its w/h are used.
const DEFAULT_BLOCK_W = 640;
const DEFAULT_BLOCK_H = 40;

export class BlockManager {
  // ── Receivers (public surface) ──────────────────────────────────────────

  // i0 — mouse. create gesture -> createBlock; cell click -> toggleCell.
  receiveMouseEvent(draft: DocDraft): DocDraft {
    switch (draft.event.triggerWord) {
      case "left-panel-block-mouse-click": //not correct -> should only create block when clicking on block option.
        return this._createBlock(draft, this.kindFromMouse(draft));
      case "database-cell-mouse-click":
        return this._toggleCell(draft);
      default:
        return draft;
    }
  }

  // i1 — key. Enter -> create text; Cmd+Shift+D -> create database;
  // Backspace on empty -> delete.
  receiveKeyEvent(draft: DocDraft): DocDraft {
    const data = draft.event.data as KeyEventData;

    if (data.metaKey && data.shiftKey && (data.key === "d" || data.key === "D")) {
      return this._createBlock(draft, "database");
    }
    if (data.key === "Enter" && !data.shiftKey) {
      return this._createBlock(draft, "text");
    }
    if (data.key === "Backspace" && this.isEmptyBlock(draft, draft.event.targetId)) {
      return this._deleteBlock(draft);
    }
    return draft;
  }

  // i2 — lifecycle. blur -> commit live text.
  receiveLifecycleEvent(draft: DocDraft): DocDraft {
    if (draft.event.triggerWord.endsWith("-blur")) {
      return this._commitText(draft);
    }
    return draft;
  }

  // ── Create: the tasks, in order ───────────────────────────────────────────

  private _createBlock(draft: DocDraft, kind: "text" | "database"): DocDraft {
    // task 1 — fresh default block (id is generated here, stays stable).
    const base = this._setDefaults();

    // task 2 — placement. x = trigger.x, y = trigger.y + trigger.h.
    const layout = this._setNonDefaultXYWH(draft, base.id);

    // task 3 — component / Tag / classNames / parentId.
    const parentId = this.content(draft)[draft.event.targetId]?.parentId ?? null;
    const block = this._setOtherNonDefaults(base, {
      component: kind === "database" ? "DatabaseArea" : "ContentArea",
      Tag: kind === "database" ? "div" : "p",
      classNames: "",
      parentId,
    });

    if (kind === "database") {
      const cells = this._buildCells(block.id); // db only
      const config = this._buildConfig(block.id, cells); // db only
      // task 4 — db block + cells -> content, placement -> layout, config -> db.
      let next = this._updateProposedDataSet(draft, [block, ...cells], [layout], config);
      // task 5 — record every new id.
      next = this._updateCreated(next, [block.id, ...cells.map((c) => c.id)]);
      return next;
    }

    // task 4 — text block -> content, placement -> layout.
    let next = this._updateProposedDataSet(draft, [block], [layout], null);
    // task 5 — record the new id.
    next = this._updateCreated(next, [block.id]);
    return next;
  }

  // task 1
  private _setDefaults(): TextElement {
    return makeTextElement();
  }

  // task 2 — reads the trigger placement out of the draft, never the DOM.
  private _setNonDefaultXYWH(draft: DocDraft, blockId: string): LayoutItem {
    const fileId = this.file(draft)?.id ?? "";
    const layouts = this.layout(draft);
    const trigger = layouts[layoutKey(fileId, draft.event.targetId)];

    let x: number;
    let y: number;
    let w: number;
    let h: number;

    if (trigger) {
      x = trigger.x;
      y = trigger.y + trigger.h;
      w = trigger.w;
      h = trigger.h;
    } else {
      // fallback: append below the lowest placement already in this file.
      const bottoms = Object.values(layouts)
        .filter((li) => li.fileId === fileId)
        .map((li) => li.y + li.h);
      x = 0;
      y = bottoms.length ? Math.max(...bottoms) : 0;
      w = DEFAULT_BLOCK_W;
      h = DEFAULT_BLOCK_H;
    }

    return { blockId, fileId, x, y, w, h };
  }

  // task 3
  private _setOtherNonDefaults(
    block: TextElement,
    overrides: Partial<TextElement>,
  ): TextElement {
    return { ...block, ...overrides };
  }

  // task 4 — fold blocks/placement/config onto the proposed slices only.
  private _updateProposedDataSet(
    draft: DocDraft,
    blocks: TextElement[],
    layouts: LayoutItem[],
    config: DatabaseConfiguration | null,
  ): DocDraft {
    const nextContent: ContentDataSet = { ...this.content(draft) };
    for (const b of blocks) nextContent[b.id] = b;

    const nextLayout: LayoutDataSet = { ...this.layout(draft) };
    for (const li of layouts) nextLayout[layoutKey(li.fileId, li.blockId)] = li;

    let databaseData = draft.dataSet.databaseData;
    if (config) {
      const nextDatabase: DatabaseDataSet = { ...this.database(draft) };
      nextDatabase[databaseKey(config.id)] = config;
      databaseData = { ...draft.dataSet.databaseData, proposed: nextDatabase };
    }

    return {
      ...draft,
      dataSet: {
        ...draft.dataSet,
        contentData: { ...draft.dataSet.contentData, proposed: nextContent },
        layoutData: { ...draft.dataSet.layoutData, proposed: nextLayout },
        databaseData,
      },
    };
  }

  // task 5
  private _updateCreated(draft: DocDraft, ids: string[]): DocDraft {
    const prev = draft.created.newBlockIds ?? [];
    const merged = [...prev, ...ids];
    return { ...draft, created: { newBlockIds: merged.length ? merged : null } };
  }

  // ── Create: database only ─────────────────────────────────────────────────

  // One cell block per column, parentId = the database block.
  private _buildCells(dbBlockId: string): TextElement[] {
    return this.defaultColumns().map(() =>
      this._setOtherNonDefaults(this._setDefaults(), {
        component: "ContentArea",
        Tag: "p",
        parentId: dbBlockId,
        innerContent: "",
      }),
    );
  }

  // The DatabaseConfiguration the cells belong to. One initial row.
  private _buildConfig(dbBlockId: string, cells: TextElement[]): DatabaseConfiguration {
    const columns = this.defaultColumns();
    const rowId = crypto.randomUUID();

    const cellMap: Record<string, string> = {};
    columns.forEach((col, i) => {
      if (cells[i]) cellMap[col.key] = cells[i].id;
    });
    const row: RowData = { id: rowId, cells: cellMap };

    const layout: DbLayoutData = {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      columnWidths: Object.fromEntries(columns.map((c) => [c.key, 160])),
    };

    return {
      id: dbBlockId,
      name: "Untitled database",
      columns,
      rows: { [rowId]: row },
      rowOrder: [rowId],
      layout,
    };
  }

  // Invented default schema — adjust freely.
  private defaultColumns(): DbColumn[] {
    return [
      { key: "col-name", name: "Name", type: "text" },
      { key: "col-done", name: "Done", type: "checkbox" },
    ];
  }

  // ── Delete + value edits ──────────────────────────────────────────────────

  // Backspace on an empty block: drop it from each slice, write proposed.
  private _deleteBlock(draft: DocDraft): DocDraft {
    const id = draft.event.targetId;
    const fileId = this.file(draft)?.id ?? "";

    const content = this.content(draft);
    if (!(id in content)) return draft;

    const nextContent: ContentDataSet = { ...content };
    delete nextContent[id];

    const nextLayout: LayoutDataSet = { ...this.layout(draft) };
    delete nextLayout[layoutKey(fileId, id)];

    let databaseData = draft.dataSet.databaseData;
    const db = this.database(draft);
    if (id in db) {
      const nextDatabase: DatabaseDataSet = { ...db };
      delete nextDatabase[id];
      databaseData = { ...draft.dataSet.databaseData, proposed: nextDatabase };
    }

    return {
      ...draft,
      dataSet: {
        ...draft.dataSet,
        contentData: { ...draft.dataSet.contentData, proposed: nextContent },
        layoutData: { ...draft.dataSet.layoutData, proposed: nextLayout },
        databaseData,
      },
    };
  }

  // Flip a checkbox cell value ("" <-> CHECKBOX_CHECKED).
  private _toggleCell(draft: DocDraft): DocDraft {
    const id = draft.event.targetId;
    const cell = this.content(draft)[id];
    if (!cell) return draft;

    const checked = cell.innerContent === CHECKBOX_CHECKED;
    const nextCell: TextElement = {
      ...cell,
      innerContent: checked ? "" : CHECKBOX_CHECKED,
    };
    const nextContent: ContentDataSet = { ...this.content(draft), [id]: nextCell };

    return {
      ...draft,
      dataSet: {
        ...draft.dataSet,
        contentData: { ...draft.dataSet.contentData, proposed: nextContent },
      },
    };
  }

  // Commit live editable text on blur.
  private _commitText(draft: DocDraft): DocDraft {
    const data = draft.event.data as LifecycleEventData;
    if (data.text === undefined) return draft; // non-editable lifecycle

    const id = draft.event.targetId;
    const block = this.content(draft)[id];
    if (!block) return draft;
    if (block.innerContent === data.text) return draft; // no change

    const nextContent: ContentDataSet = {
      ...this.content(draft),
      [id]: { ...block, innerContent: data.text },
    };

    return {
      ...draft,
      dataSet: {
        ...draft.dataSet,
        contentData: { ...draft.dataSet.contentData, proposed: nextContent },
      },
    };
  }

  // ── Reads: proposed ?? currentReadOnly (chain-aware, read only) ────────────

  private content(draft: DocDraft): ContentDataSet {
    return draft.dataSet.contentData.proposed ?? draft.dataSet.contentData.currentReadOnly;
  }

  private layout(draft: DocDraft): LayoutDataSet {
    return draft.dataSet.layoutData.proposed ?? draft.dataSet.layoutData.currentReadOnly;
  }

  private database(draft: DocDraft): DatabaseDataSet {
    return draft.dataSet.databaseData.proposed ?? draft.dataSet.databaseData.currentReadOnly;
  }

  private file(draft: DocDraft): FileData | null {
    return draft.dataSet.fileData.proposed ?? draft.dataSet.fileData.currentReadOnly;
  }

  // ── Small derivations ─────────────────────────────────────────────────────

  private isEmptyBlock(draft: DocDraft, id: string): boolean {
    const block = this.content(draft)[id];
    return !!block && block.innerContent === "";
  }

  private kindFromMouse(draft: DocDraft): "text" | "database" {
    const data = draft.event.data as MouseEventData;
    // blockType is a string today; maps to component_registry later.
    return data.blockType === "DatabaseArea" ? "database" : "text";
  }
}