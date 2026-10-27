import { describe, expect, it } from "vitest";
import { financeExpenseComponents } from "./expense-details";

describe("financeExpenseComponents", () => {
  it("shows only the fee line for the product and type represented by an ITEM expense", () => {
    expect(financeExpenseComponents({
      externalKey: "2026-10-20:ITEM:order:item:sku:sku-1:type:71",
      accruedCategory: "ITEM",
      typeId: "71",
      amount: "-25.00",
      relatedSkus: ["sku-1"],
      raw: {
        item_fees: { fees: [
          { sku: "sku-1", quantity: 2, fees: [{ type_id: 71, accrued: { amount: "-25.00" } }] },
          { sku: "sku-2", quantity: 1, fees: [{ type_id: 71, accrued: { amount: "-10.00" } }] },
          { sku: "sku-1", quantity: 2, fees: [{ type_id: 1, accrued: { amount: "-1.20" } }] },
        ] },
      },
    })).toEqual([{
      typeId: "71",
      label: "Обработка товара",
      amount: -25,
      sku: "sku-1",
      quantity: 2,
    }]);
  });

  it("lists matching container fees when Ozon sends a fee breakdown", () => {
    expect(financeExpenseComponents({
      externalKey: "expense-1",
      accruedCategory: "NON_ITEM",
      typeId: "77",
      amount: "-35.00",
      relatedSkus: ["sku-1"],
      raw: { container_fees: { fees: [
        { type_id: 77, accrued: { amount: "-35.00" } },
        { type_id: 12, accrued: { amount: "-10.00" } },
      ] } },
    })).toEqual([{
      typeId: "77",
      label: "Обработка поставки",
      amount: -35,
      sku: null,
      quantity: null,
    }]);
  });

  it("returns no fabricated breakdown when Ozon only sent one total amount", () => {
    expect(financeExpenseComponents({
      externalKey: "expense-2",
      accruedCategory: "NON_ITEM",
      typeId: "12",
      amount: "-112.00",
      relatedSkus: ["sku-1"],
      raw: { non_item_fee: { type_id: 12, accrued: { amount: "-112.00" } } },
    })).toEqual([]);
  });
});
