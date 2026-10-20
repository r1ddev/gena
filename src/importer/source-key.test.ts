import { describe, expect, it } from "vitest";
import { getImportRowFingerprint, makeImportSourceKey, makeStableImportRowKeys } from "./source-key";

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

  it("keeps operation identity when the worksheet is renamed", () => {
    const data = { headers: ["SKU", "Amount"], cells: { sku: "SKU-1", amount: "100" }, values: ["SKU-1", "100"] };
    const original = makeStableImportRowKeys([
      { id: "original", sheetName: "Purchases", rowNumber: 2, rowType: "purchases", data },
    ]);
    const renamed = makeStableImportRowKeys([
      { id: "renamed", sheetName: "Purchases 2026", rowNumber: 2, rowType: "purchases", data },
    ]);

    expect(renamed.get("renamed")).toBe(original.get("original"));
  });

  it("distinguishes repeated identical rows by their occurrence", () => {
    const data = { headers: ["SKU", "Amount"], cells: { sku: "SKU-1", amount: "100" }, values: ["SKU-1", "100"] };
    const keys = makeStableImportRowKeys([
      { id: "a", sheetName: "Expenses", rowNumber: 2, rowType: "expenses", data },
      { id: "b", sheetName: "Expenses", rowNumber: 3, rowType: "expenses", data },
    ]);

    expect(keys.get("a")).not.toBe(keys.get("b"));
  });

  it("uses the same operation identity for equivalent XLSX and CSV values", () => {
    const xlsx = {
      headers: ["SKU", "Дата закупки", "Количество", "Цена за единицу"],
      cells: { sku: "BAG-1", датазакупки: new Date("2026-10-20T00:00:00.000Z"), количество: 2, ценазаединицу: 50 },
      values: ["BAG-1", new Date("2026-10-20T00:00:00.000Z"), 2, 50],
    };
    const csv = {
      headers: ["SKU", "Дата закупки", "Количество", "Цена за единицу"],
      cells: { sku: "BAG-1", датазакупки: "20.10.2026", количество: "2", ценазаединицу: "50,00" },
      values: ["BAG-1", "20.10.2026", "2", "50,00"],
    };

    const xlsxKey = makeStableImportRowKeys([{ id: "xlsx", sheetName: "Закупки", rowNumber: 2, rowType: "purchases", data: xlsx }]);
    const csvKey = makeStableImportRowKeys([{ id: "csv", sheetName: "Лист 1", rowNumber: 12, rowType: "purchases", data: csv }]);

    expect(csvKey.get("csv")).toBe(xlsxKey.get("xlsx"));
  });

  it("uses the same expense identity across equivalent XLSX and CSV headers", () => {
    const xlsx = {
      headers: ["Дата", "Категория", "Сумма"],
      cells: { дата: new Date("2026-10-01T00:00:00.000Z"), категория: "Доставка 42", сумма: 100 },
      values: [new Date("2026-10-01T00:00:00.000Z"), "Доставка 42", 100],
    };
    const csv = {
      headers: ["Дата расхода", "Расход", "Сумма"],
      cells: { датарасхода: "01.10.2026", расход: "Доставка 42", сумма: "100" },
      values: ["01.10.2026", "Доставка 42", "100"],
    };
    const xlsxRow = { id: "xlsx", sheetName: "Расходы", rowNumber: 2, rowType: "expenses", data: xlsx };
    const csvRow = { id: "csv", sheetName: "CSV", rowNumber: 2, rowType: "expenses", data: csv };

    expect(getImportRowFingerprint(csvRow)).toBe(getImportRowFingerprint(xlsxRow));
    expect(makeStableImportRowKeys([csvRow]).get("csv")).toBe(makeStableImportRowKeys([xlsxRow]).get("xlsx"));
  });
});
