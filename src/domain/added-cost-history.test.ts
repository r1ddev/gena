import { describe, expect, it } from "vitest";
import type { AccountingInput } from "./accounting";
import { calculateAddedCostRateByPosting } from "./added-cost-history";

describe("calculateAddedCostRateByPosting", () => {
  it("clears the added-cost rate when the full sale is returned to the seller", () => {
    const input: AccountingInput = {
      products: [{ id: "bag", sku: "BAG-1", title: "Косметичка" }],
      purchases: [],
      receipts: [
        { productId: "bag", quantity: "3", unitCost: "100", receivedAt: "2025-12-01T00:00:00.000Z" },
        { productId: "bag", quantity: "3", unitCost: "100", receivedAt: "2025-12-03T00:00:00.000Z" },
      ],
      supplies: [],
      expenses: [{ amount: "30", spentAt: "2025-12-01" }],
      ozonSharedExpenses: [],
      postings: [
        { id: "returned-sale", status: "returned", deliveredAt: "2025-12-02T00:00:00.000Z", isMarketplaceBuyout: false },
        { id: "sale-after-receipt", status: "delivered", deliveredAt: "2025-12-04T00:00:00.000Z", isMarketplaceBuyout: false },
        { id: "sale-after-return", status: "delivered", deliveredAt: "2025-12-06T00:00:00.000Z", isMarketplaceBuyout: false },
      ],
      postingItems: [
        { postingId: "returned-sale", productId: "bag", quantity: "1", price: "150" },
        { postingId: "sale-after-receipt", productId: "bag", quantity: "1", price: "150" },
        { postingId: "sale-after-return", productId: "bag", quantity: "1", price: "150" },
      ],
      financeAccruals: [],
      returns: [{
        externalId: "return-1",
        postingId: "returned-sale",
        productId: "bag",
        quantity: "1",
        destination: "seller",
        returnedAt: "2025-12-04T00:00:00.000Z",
        receivedBySellerAt: "2025-12-05T00:00:00.000Z",
        writtenOffAt: null,
        availableAtOzon: null,
      }],
      manualWriteoffs: [],
      ozonWriteoffs: [],
      stockAdjustments: [],
    };

    const rates = calculateAddedCostRateByPosting(input, new Date("2025-12-07T00:00:00.000Z"));

    expect(rates.has("returned-sale")).toBe(false);
    expect(rates.get("sale-after-return")).toBe("5.20000000");
  });

  it("does not assign added cost to a cancelled posting returned to the seller", () => {
    const input: AccountingInput = {
      products: [{ id: "bag", sku: "BAG-1", title: "Косметичка" }],
      purchases: [],
      receipts: [{ productId: "bag", quantity: "2", unitCost: "100", receivedAt: "2025-12-01T00:00:00.000Z" }],
      supplies: [],
      expenses: [{ amount: "10", spentAt: "2025-12-01" }],
      ozonSharedExpenses: [],
      postings: [
        { id: "cancelled", status: "cancelled", deliveredAt: null, isMarketplaceBuyout: false },
        { id: "cancelled-with-delivery-date", status: "cancelled", deliveredAt: "2025-12-03T00:00:00.000Z", isMarketplaceBuyout: false },
        { id: "sale", status: "delivered", deliveredAt: "2025-12-06T00:00:00.000Z", isMarketplaceBuyout: false },
      ],
      postingItems: [
        { postingId: "cancelled", productId: "bag", quantity: "1", price: "150" },
        { postingId: "cancelled-with-delivery-date", productId: "bag", quantity: "1", price: "150" },
        { postingId: "sale", productId: "bag", quantity: "1", price: "150" },
      ],
      financeAccruals: [],
      returns: [{
        externalId: "cancelled-return",
        postingId: "cancelled",
        productId: "bag",
        quantity: "1",
        destination: "seller",
        returnedAt: "2025-12-04T00:00:00.000Z",
        receivedBySellerAt: "2025-12-05T00:00:00.000Z",
        writtenOffAt: null,
        availableAtOzon: null,
      }],
      manualWriteoffs: [],
      ozonWriteoffs: [],
      stockAdjustments: [],
    };

    const rates = calculateAddedCostRateByPosting(input, new Date("2025-12-07T00:00:00.000Z"));

    expect(rates.has("cancelled")).toBe(false);
    expect(rates.has("cancelled-with-delivery-date")).toBe(false);
    expect(rates.get("sale")).toBe("5.00000000");
  });

  it("keeps the rate when only part of a multi-unit sale is returned", () => {
    const input: AccountingInput = {
      products: [{ id: "bag", sku: "BAG-1", title: "Косметичка" }],
      purchases: [],
      receipts: [{ productId: "bag", quantity: "2", unitCost: "100", receivedAt: "2025-12-01T00:00:00.000Z" }],
      supplies: [],
      expenses: [{ amount: "10", spentAt: "2025-12-01" }],
      ozonSharedExpenses: [],
      postings: [{ id: "partially-returned", status: "returned", deliveredAt: "2025-12-02T00:00:00.000Z", isMarketplaceBuyout: false }],
      postingItems: [{ postingId: "partially-returned", productId: "bag", quantity: "2", price: "150" }],
      financeAccruals: [],
      returns: [{
        externalId: "partial-return",
        postingId: "partially-returned",
        productId: "bag",
        quantity: "1",
        destination: "seller",
        returnedAt: "2025-12-04T00:00:00.000Z",
        receivedBySellerAt: "2025-12-05T00:00:00.000Z",
        writtenOffAt: null,
        availableAtOzon: null,
      }],
      manualWriteoffs: [],
      ozonWriteoffs: [],
      stockAdjustments: [],
    };

    const rates = calculateAddedCostRateByPosting(input, new Date("2025-12-07T00:00:00.000Z"));

    expect(rates.get("partially-returned")).toBe("5.00000000");
  });

  it("clears the returned sale rate and restores added cost when Ozon receives the item", () => {
    const input: AccountingInput = {
      products: [{ id: "bag", sku: "BAG-1", title: "Косметичка" }],
      purchases: [],
      receipts: [{ productId: "bag", quantity: "2", unitCost: "100", receivedAt: "2025-12-01T00:00:00.000Z" }],
      supplies: [],
      expenses: [{ amount: "10", spentAt: "2025-12-01" }, { amount: "10", spentAt: "2025-12-04" }],
      ozonSharedExpenses: [],
      postings: [
        { id: "sale", status: "delivered", deliveredAt: "2025-12-02T00:00:00.000Z", isMarketplaceBuyout: false },
        { id: "sale-after-return", status: "delivered", deliveredAt: "2025-12-06T00:00:00.000Z", isMarketplaceBuyout: false },
      ],
      postingItems: [
        { postingId: "sale", productId: "bag", quantity: "1", price: "150" },
        { postingId: "sale-after-return", productId: "bag", quantity: "1", price: "150" },
      ],
      financeAccruals: [],
      returns: [{
        externalId: "ozon-return",
        postingId: "sale",
        productId: "bag",
        quantity: "1",
        destination: "ozon",
        returnedAt: "2025-12-04T00:00:00.000Z",
        receivedBySellerAt: null,
        writtenOffAt: null,
        availableAtOzon: "2025-12-05T00:00:00.000Z",
      }],
      manualWriteoffs: [],
      ozonWriteoffs: [],
      stockAdjustments: [],
    };

    const rates = calculateAddedCostRateByPosting(input, new Date("2025-12-07T00:00:00.000Z"));

    expect(rates.has("sale")).toBe(false);
    expect(rates.get("sale-after-return")).toBe("10.00000000");
  });
});
