import { describe, expect, it } from "vitest";
import { makeImportSourceKey, makeStableImportRowKeys } from "./source-key";

describe("makeImportSourceKey", () => {
  it("stays stable for the same content and keeps changed imports apart", () => {
    const first = makeImportSourceKey("content-hash-1", "row:Expenses:2");

    expect(makeImportSourceKey("content-hash-1", "row:Expenses:2")).toBe(first);
    expect(makeImportSourceKey("content-hash-1", "row:Expenses:3")).not.toBe(first);
    expect(makeImportSourceKey("content-hash-2", "row:Expenses:2")).not.toBe(first);
  });
});

describe("makeStableImportRowKeys", () => {
  it("keeps operation identity when a workbook is renamed or rows are reordered", () => {
    const data = { headers: ["SKU", "Amount"], cells: { sku: "SKU-1", amount: "100" }, values: ["SKU-1", "100"] };
    const first = makeStableImportRowKeys([
      { id: "a", sheetName: "Purchases", rowNumber: 2, rowType: "purchases", data },
      { id: "b", sheetName: "Purchases", rowNumber: 3, rowType: "purchases", data: { headers: ["SKU", "Amount"], cells: { sku: "SKU-2", amount: "200" }, values: ["SKU-2", "200"] } },
    ]);
    const renamedAndReordered = makeStableImportRowKeys([
      { id: "new-b", sheetName: "Purchases", rowNumber: 25, rowType: "purchases", data: { headers: ["SKU", "Amount"], cells: { sku: "SKU-2", amount: "200" }, values: ["SKU-2", "200"] } },
      { id: "new-a", sheetName: "Purchases", rowNumber: 26, rowType: "purchases", data },
    ]);

    expect(renamedAndReordered.get("new-a")).toBe(first.get("a"));
    expect(renamedAndReordered.get("new-b")).toBe(first.get("b"));
  });

  it("distinguishes repeated identical rows by their occurrence", () => {
    const data = { headers: ["SKU", "Amount"], cells: { sku: "SKU-1", amount: "100" }, values: ["SKU-1", "100"] };
    const keys = makeStableImportRowKeys([
      { id: "a", sheetName: "Expenses", rowNumber: 2, rowType: "expenses", data },
      { id: "b", sheetName: "Expenses", rowNumber: 3, rowType: "expenses", data },
    ]);

    expect(keys.get("a")).not.toBe(keys.get("b"));
  });
});
