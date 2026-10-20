import { describe, expect, it } from "vitest";
import { getAmbiguousStocktakeWarehouseRows, uniqueStocktakeLines } from "./stocktakes";

describe("uniqueStocktakeLines", () => {
  it("keeps one copy of identical product counts", () => {
    const first = { productId: "product-1", expected: 4, actual: 3, source: "row-a", rowId: "a" };
    const second = { ...first, source: "row-b", rowId: "b" };

    expect(uniqueStocktakeLines([first, second])).toEqual({ lines: [first], conflicts: [] });
  });

  it("rejects conflicting counts for the same product instead of choosing one", () => {
    const first = { productId: "product-1", expected: 4, actual: 3, source: "row-a", rowId: "a" };
    const second = { productId: "product-1", expected: 4, actual: 2, source: "row-b", rowId: "b" };

    expect(uniqueStocktakeLines([first, second])).toEqual({ lines: [], conflicts: [{ productId: "product-1", rows: [first, second] }] });
  });
});

describe("getAmbiguousStocktakeWarehouseRows", () => {
  it("rejects identical rows inferred for different warehouses when at least one warehouse is implicit", () => {
    expect(getAmbiguousStocktakeWarehouseRows([
      { rowId: "seller-row", identity: "same-row", warehouse: "seller", explicitWarehouse: false },
      { rowId: "ozon-row", identity: "same-row", warehouse: "ozon", explicitWarehouse: false },
    ])).toEqual(new Set(["seller-row", "ozon-row"]));
  });

  it("keeps repeated identical rows when they all resolve to one warehouse", () => {
    expect(getAmbiguousStocktakeWarehouseRows([
      { rowId: "first", identity: "same-row", warehouse: "seller", explicitWarehouse: false },
      { rowId: "second", identity: "same-row", warehouse: "seller", explicitWarehouse: false },
    ])).toEqual(new Set());
  });

  it("allows different warehouses when every row names its warehouse explicitly", () => {
    expect(getAmbiguousStocktakeWarehouseRows([
      { rowId: "seller-row", identity: "same-row", warehouse: "seller", explicitWarehouse: true },
      { rowId: "ozon-row", identity: "same-row", warehouse: "ozon", explicitWarehouse: true },
    ])).toEqual(new Set());
  });
});
