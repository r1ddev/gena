import { describe, expect, it } from "vitest";
import { getImportedReceivedQuantity, shouldDeleteImportedReceipt } from "./purchases";

describe("getImportedReceivedQuantity", () => {
  it("uses the ordered quantity when the workbook marks a purchase as received", () => {
    expect(getImportedReceivedQuantity({ получен: "Да" }, 3)).toBe(3);
    expect(getImportedReceivedQuantity({ получен: "получен" }, 3)).toBe(3);
    expect(getImportedReceivedQuantity({ получен: "Нет" }, 3)).toBe(0);
  });

  it("preserves an explicit partial receipt quantity", () => {
    expect(getImportedReceivedQuantity({ получено: "2" }, 5)).toBe(2);
    expect(getImportedReceivedQuantity({}, 5)).toBe(0);
  });
});

describe("shouldDeleteImportedReceipt", () => {
  it("removes a previously imported receipt only when the received quantity is zero", () => {
    expect(shouldDeleteImportedReceipt(0)).toBe(true);
    expect(shouldDeleteImportedReceipt(-1)).toBe(true);
    expect(shouldDeleteImportedReceipt(2)).toBe(false);
  });

});
