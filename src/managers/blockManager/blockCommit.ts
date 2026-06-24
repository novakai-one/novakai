// ── blockCommit ───────────────────────────────────────────────────────────────
// writeSlices: replace whichever named slices a holder built, leaving the rest
// untouched. Used by delete / toggle / text commit. The create path writes its
// proposed slices directly in BlockManager._updateProposedDataSet.

import type {
  DocShape,
  ContentDataSet,
  LayoutDataSet,
  DatabaseDataSet,
  FileData,
} from "../../types/types";

// The named slices a holder may replace in one fold. Omitted slices pass through.
export interface BlockSlices {
  file: FileData;
  contentData: ContentDataSet;
  layoutData: LayoutDataSet;
  databaseData: DatabaseDataSet;
}

export const writeSlices = (
  shape: DocShape,
  slices: Partial<BlockSlices>,
): DocShape => {
  return {
    ...shape,
    ...(slices.file !== undefined ? { file: slices.file } : {}),
    ...(slices.contentData !== undefined
      ? { contentData: slices.contentData }
      : {}),
    ...(slices.layoutData !== undefined
      ? { layoutData: slices.layoutData }
      : {}),
    ...(slices.databaseData !== undefined
      ? { databaseData: slices.databaseData }
      : {}),
  };
};
