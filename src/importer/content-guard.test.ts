import { describe, expect, it } from "vitest";
import { findChangedAppliedBatch, findChangedAppliedRow, findPreviouslyAppliedBatch } from "./content-guard";

describe("findPreviouslyAppliedBatch", () => {
  it("blocks applying a second preview with identical file content", () => {
    expect(findPreviouslyAppliedBatch(
      { id: "preview-2", contentHash: "same-file" },
      [{ id: "applied-1", contentHash: "same-file", status: "applied" }],
    )).toEqual({ id: "applied-1", contentHash: "same-file", status: "applied" });
  });

  it("allows different content and ignores the current batch", () => {
    expect(findPreviouslyAppliedBatch(
      { id: "preview-1", contentHash: "same-file" },
      [
        { id: "preview-1", contentHash: "same-file", status: "applied" },
        { id: "other", contentHash: "different-file", status: "applied" },
      ],
    )).toBeUndefined();
  });
});

describe("findChangedAppliedBatch", () => {
  it("finds a changed file with the same name after an earlier version was applied", () => {
    expect(findChangedAppliedBatch(
      { id: "preview-2", fileName: "history.xlsx", contentHash: "new-content" },
      [{ id: "applied-1", fileName: "history.xlsx", contentHash: "old-content", status: "applied" }],
    )).toEqual({ id: "applied-1", fileName: "history.xlsx", contentHash: "old-content", status: "applied" });
  });

  it("treats older applied imports without a content hash as a changed version", () => {
    expect(findChangedAppliedBatch(
      { id: "preview-2", fileName: "history.xlsx", contentHash: "new-content" },
      [{ id: "applied-1", fileName: "history.xlsx", contentHash: null, status: "applied" }],
    )).toEqual({ id: "applied-1", fileName: "history.xlsx", contentHash: null, status: "applied" });
  });

  it("ignores exact content, other filenames, and the current batch", () => {
    expect(findChangedAppliedBatch(
      { id: "preview-1", fileName: "history.xlsx", contentHash: "same-content" },
      [
        { id: "preview-1", fileName: "history.xlsx", contentHash: "same-content", status: "applied" },
        { id: "applied-1", fileName: "history.xlsx", contentHash: "same-content", status: "applied" },
        { id: "applied-2", fileName: "other.xlsx", contentHash: "other-content", status: "applied" },
      ],
    )).toBeUndefined();
  });
});

describe("findChangedAppliedRow", () => {
  it("finds an edited row at the same workbook location even when the file was renamed", () => {
    expect(findChangedAppliedRow(
      [{ id: "new", sheetName: "Purchases", rowNumber: 12, rowType: "purchases", data: { cells: { amount: "120" } } }],
      [{ id: "old", sheetName: "Purchases", rowNumber: 12, rowType: "purchases", data: { cells: { amount: "100" } } }],
    )).toEqual({ id: "old", sheetName: "Purchases", rowNumber: 12, rowType: "purchases", data: { cells: { amount: "100" } } });
  });

  it("allows unchanged rows and new rows", () => {
    const unchanged = { id: "same", sheetName: "Purchases", rowNumber: 12, rowType: "purchases", data: { cells: { amount: "100" } } };
    expect(findChangedAppliedRow(
      [unchanged, { ...unchanged, id: "added", rowNumber: 13, data: { cells: { amount: "200" } } }],
      [unchanged],
    )).toBeUndefined();
  });

  it("allows previously applied rows to be reordered", () => {
    const first = { id: "first", sheetName: "Purchases", rowNumber: 12, rowType: "purchases", data: { cells: { amount: "100" } } };
    const second = { id: "second", sheetName: "Purchases", rowNumber: 13, rowType: "purchases", data: { cells: { amount: "200" } } };
    expect(findChangedAppliedRow(
      [{ ...second, rowNumber: 12 }, { ...first, rowNumber: 13 }],
      [{ ...first, batchId: "batch-1" }, { ...second, batchId: "batch-1" }],
    )).toBeUndefined();
  });

  it("detects a removed row in an overlapping renamed workbook", () => {
    const first = { id: "first", sheetName: "Purchases", rowNumber: 2, rowType: "purchases", data: { cells: { sku: "A-1" } } };
    const removed = { id: "removed", sheetName: "Purchases", rowNumber: 3, rowType: "purchases", data: { cells: { sku: "B-2" } } };
    expect(findChangedAppliedRow([first], [first, removed])).toEqual(removed);
  });
});
