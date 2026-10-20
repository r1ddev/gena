import { describe, expect, it } from "vitest";
import { calculateAccounting, type AccountingInput } from "./accounting";

const base = (overrides: Partial<AccountingInput> = {}): AccountingInput => ({
  products: [{ id: "p1", sku: "BAG-1", title: "Сумка" }],
  purchases: [{ id: "purchase-1", amountPaid: "100" }],
  receipts: [
    { productId: "p1", quantity: "2", unitCost: "50" },
  ],
  supplies: [],
  expenses: [],
  postings: [],
  postingItems: [],
  financeAccruals: [],
  returns: [],
  manualWriteoffs: [],
  ozonWriteoffs: [],
  stockAdjustments: [],
  ...overrides,
});

describe("calculateAccounting", () => {
  it("uses only received purchase batches for weighted cost and inventory", () => {
    const result = calculateAccounting(
      base({
        receipts: [
          { productId: "p1", quantity: "1", unitCost: "40" },
          { productId: "p1", quantity: "3", unitCost: "60" },
        ],
        purchases: [{ id: "purchase-1", amountPaid: "300" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0]).toMatchObject({
      averagePurchaseCost: "55.00",
      sellerStock: "4.000",
      ozonStock: "0.000",
    });
  });

  it("deducts purchase cash immediately but recognizes no pending order income before 21 days", () => {
    const result = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "2", shippingCost: "0" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-10-10T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-100.00");
    expect(result.confirmedProfit).toBe("0.00");
    expect(result.preliminaryOrders).toMatchObject({ count: 1, grossAmount: "300.00" });
    expect(result.products[0].ozonStock).toBe("1.000");
  });

  it("recognizes a delivered order after 21 days and computes profit from landed cost", () => {
    const result = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "2", shippingCost: "0" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-20T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("200.00");
    expect(result.confirmedProfit).toBe("250.00");
    expect(result.products[0].ozonStock).toBe("1.000");
  });

  it("treats a seller loss as stock and profit loss, without another cash outflow", () => {
    const result = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "0", suppliedAt: "2026-10-01" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-20T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
        manualWriteoffs: [{ productId: "p1", quantity: "1" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("200.00");
    expect(result.confirmedProfit).toBe("200.00");
    expect(result.products[0].sellerStock).toBe("0.000");
  });

  it("applies the shared expense coefficient to landed cost once", () => {
    const result = calculateAccounting(
      base({
        purchases: [{ id: "purchase-1", amountPaid: "100" }],
        expenses: [{ amount: "10" }],
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "10" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-20T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.sharedExpenseCoefficient).toBe("0.20");
    expect(result.products[0].landedUnitCost).toBe("60.00");
    expect(result.cashBalance).toBe("180.00");
    expect(result.confirmedProfit).toBe("240.00");
  });

  it("counts marketplace buyouts immediately from their financial records", () => {
    const result = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "2", shippingCost: "0" }],
        postings: [{ id: "buyout-1", status: "delivered", deliveredAt: "2026-10-20T10:00:00Z", marketplaceBuyoutAt: "2026-10-20T10:00:00Z", isMarketplaceBuyout: true }],
        postingItems: [{ postingId: "buyout-1", productId: "p1", quantity: "1", price: "120" }],
        financeAccruals: [{ postingId: "buyout-1", amount: "120" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("20.00");
    expect(result.confirmedProfit).toBe("70.00");
  });

  it("recognizes a financial-report buyout even when no buyer-delivery timestamp exists", () => {
    const result = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "0", suppliedAt: "2026-10-01" }],
        stockAdjustments: [{ productId: "p1", warehouse: "ozon", actualQuantity: "1", countedAt: "2026-10-10" }],
        postings: [{ id: "buyout-2", status: "delivered", deliveredAt: null, marketplaceBuyoutAt: "2026-10-15T12:00:00Z", isMarketplaceBuyout: true }],
        postingItems: [{ postingId: "buyout-2", productId: "p1", quantity: "1", price: "120" }],
        financeAccruals: [{ postingId: "buyout-2", amount: "120" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("20.00");
    expect(result.confirmedProfit).toBe("70.00");
    expect(result.products[0].ozonStock).toBe("0.000");

    const beforeReport = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "0", suppliedAt: "2026-10-01" }],
        stockAdjustments: [{ productId: "p1", warehouse: "ozon", actualQuantity: "1", countedAt: "2026-10-10" }],
        postings: [{ id: "buyout-2", status: "delivered", deliveredAt: null, marketplaceBuyoutAt: "2026-10-15T12:00:00Z", isMarketplaceBuyout: true }],
        postingItems: [{ postingId: "buyout-2", productId: "p1", quantity: "1", price: "120" }],
        financeAccruals: [{ postingId: "buyout-2", amount: "120" }],
      }),
      new Date("2026-10-12T12:00:00Z"),
    );
    expect(beforeReport.products[0].ozonStock).toBe("1.000");
    expect(beforeReport.cashBalance).toBe("-100.00");
  });

  it("waits for Ozon's financial buyout report before recognizing a marked buyout", () => {
    const result = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "0" }],
        postings: [{ id: "buyout-pending", status: "delivered", deliveredAt: "2026-10-20T10:00:00Z", marketplaceBuyoutAt: null, isMarketplaceBuyout: true }],
        postingItems: [{ postingId: "buyout-pending", productId: "p1", quantity: "1", price: "120" }],
        financeAccruals: [{ postingId: "buyout-pending", amount: "120" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-100.00");
    expect(result.confirmedProfit).toBe("0.00");
    expect(result.preliminaryOrders.count).toBe(0);
    expect(result.products[0].ozonStock).toBe("0.000");
  });

  it("adds returned stock only after the seller receives it or Ozon makes it sellable", () => {
    const result = calculateAccounting(
      base({
        receipts: [{ productId: "p1", quantity: "1", unitCost: "50" }],
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "0" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-20T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
        returns: [
          { postingId: "post-1", productId: "p1", quantity: "1", destination: "seller", receivedBySellerAt: null, availableAtOzon: null },
          { postingId: "post-1", productId: "p1", quantity: "1", destination: "seller", receivedBySellerAt: "2026-10-20T10:00:00Z", availableAtOzon: null },
        ],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0].sellerStock).toBe("1.000");
    expect(result.products[0].ozonStock).toBe("0.000");
  });

  it("subtracts one return once when multiple Ozon item rows map to the same product", () => {
    const result = calculateAccounting(
      base({
        purchases: [{ id: "purchase-1", amountPaid: "100" }],
        receipts: [{ productId: "p1", quantity: "2", unitCost: "50" }],
        supplies: [{ productId: "p1", quantity: "2", shippingCost: "0", suppliedAt: "2026-09-01" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-20T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [
          { postingId: "post-1", productId: "p1", quantity: "1", price: "300" },
          { postingId: "post-1", productId: "p1", quantity: "1", price: "300" },
        ],
        financeAccruals: [{ postingId: "post-1", amount: "600" }],
        returns: [{ postingId: "post-1", productId: "p1", quantity: "1", destination: "seller", receivedBySellerAt: "2026-10-01T10:00:00Z", availableAtOzon: null }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.confirmedProfit).toBe("550.00");
    expect(result.products[0].sellerStock).toBe("1.000");
  });

  it("recalculates naturally from source operations and permits negative stock", () => {
    const result = calculateAccounting(
      base({
        supplies: [{ productId: "p1", quantity: "4", shippingCost: "0" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0].sellerStock).toBe("-2.000");
    expect(result.products[0].ozonStock).toBe("4.000");
    expect(result.reconciliationErrors).toHaveLength(1);
  });

  it("honors an explicit zero quantity from a stocktake", () => {
    const result = calculateAccounting(
      base({ stockAdjustments: [{ productId: "p1", warehouse: "seller", actualQuantity: "0", countedAt: "2026-10-20" }] }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0].sellerStock).toBe("0.000");
  });

  it("builds a backdated stocktake snapshot without later stock movements", () => {
    const result = calculateAccounting(
      base({
        receipts: [{ productId: "p1", quantity: "4", unitCost: "50", receivedAt: "2026-10-10" }],
        supplies: [{ productId: "p1", quantity: "2", shippingCost: "0", suppliedAt: "2026-10-11" }],
      }),
      new Date("2026-10-05T23:59:59.999Z"),
    );

    expect(result.products[0].sellerStock).toBe("0.000");
    expect(result.products[0].ozonStock).toBe("0.000");
  });

  it("counts direct item, seller, and container Ozon charges while excluding unmapped item charges", () => {
    const result = calculateAccounting(
      base({
        purchases: [],
        financeAccruals: [
          { postingId: null, productId: "p1", amount: "-5", category: "ITEM" },
          { postingId: null, productId: null, amount: "-7", category: "ITEM" },
          { postingId: null, amount: "-3", category: "NON_ITEM" },
          { postingId: null, amount: "-2", category: "CONTAINER_FEES" },
        ],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-10.00");
    expect(result.confirmedProfit).toBe("-10.00");
    expect(result.unrecognizedFinanceAmount).toBe("-7.00");
  });

  it("excludes a delivered posting until every product is mapped or explicitly created", () => {
    const result = calculateAccounting(
      base({
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-20T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [
          { postingId: "post-1", productId: "p1", quantity: "1", price: "300" },
          { postingId: "post-1", productId: null, quantity: "1", price: "300" },
        ],
        financeAccruals: [{ postingId: "post-1", amount: "600", category: "POSTING" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-100.00");
    expect(result.confirmedProfit).toBe("0.00");
    expect(result.preliminaryOrders.count).toBe(0);
    expect(result.products[0].ozonStock).toBe("0.000");
    expect(result.unrecognizedFinanceAmount).toBe("600.00");
  });

  it("returns signed cash and profit breakdowns that add back to each balance", () => {
    const result = calculateAccounting(
      base({
        expenses: [{ amount: "10" }],
        supplies: [{ productId: "p1", quantity: "2", shippingCost: "10" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-20T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
        manualWriteoffs: [{ productId: "p1", quantity: "1" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBreakdown).toEqual({
      recognizedOzon: "300.00",
      purchases: "-100.00",
      expenses: "-10.00",
      supplyShipping: "-10.00",
      total: "180.00",
    });
    expect(result.profitBreakdown).toEqual({
      recognizedOzon: "300.00",
      soldPurchaseCost: "-50.00",
      soldSharedCosts: "-10.00",
      manualLossPurchaseCost: "-50.00",
      manualLossSharedCosts: "-10.00",
      ozonWriteoffPurchaseCost: "0.00",
      ozonWriteoffSharedCosts: "0.00",
      total: "180.00",
    });
  });

  it("handles cancelled, future, unmapped, and zero-cost operations without inventing stock or profit", () => {
    const result = calculateAccounting(
      base({
        products: [
          { id: "p1", sku: "BAG-1", title: "Сумка" },
          { id: "p2", sku: "BAG-2", title: "Кошелёк" },
        ],
        purchases: [],
        receipts: [],
        supplies: [{ productId: "", quantity: "0", shippingCost: "0" }],
        postings: [
          { id: "cancelled", status: "cancelled", deliveredAt: null, isMarketplaceBuyout: false, accountingEnabled: true },
          { id: "future", status: "delivering", deliveredAt: "2026-10-30T10:00:00Z", isMarketplaceBuyout: false, accountingEnabled: true },
          { id: "unmapped", status: "delivered", deliveredAt: "2026-09-01T10:00:00Z", isMarketplaceBuyout: false, accountingEnabled: false },
        ],
        postingItems: [
          { postingId: "future", productId: "p1", quantity: "1", price: "100" },
          { postingId: "unmapped", productId: null, quantity: "1", price: "100" },
        ],
        financeAccruals: [
          { postingId: "cancelled", amount: "-5", category: "POSTING" },
          { postingId: "unmapped", amount: "100", category: "POSTING" },
          { postingId: null, amount: "-2", category: "UNKNOWN" },
        ],
        returns: [
          { postingId: null, productId: null, quantity: "1", destination: "seller", receivedBySellerAt: null, availableAtOzon: null },
          { postingId: null, productId: "p1", quantity: "1", destination: "unknown", receivedBySellerAt: null, availableAtOzon: null },
          { postingId: null, productId: "p1", quantity: "1", destination: "ozon", receivedBySellerAt: null, availableAtOzon: null },
        ],
        manualWriteoffs: [{ productId: "p2", quantity: "0" }],
        ozonWriteoffs: [
          { productId: null, quantity: "1" },
          { productId: "p2", quantity: "1", occurredAt: "2026-10-19" },
        ],
        stockAdjustments: [{ productId: "p2", warehouse: "ozon", actualQuantity: "3", countedAt: "2026-10-30" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-5.00");
    expect(result.confirmedProfit).toBe("-5.00");
    expect(result.unrecognizedFinanceAmount).toBe("98.00");
    expect(result.preliminaryOrders.count).toBe(0);
    expect(result.products.map(({ averagePurchaseCost, sellerStock, ozonStock }) => ({ averagePurchaseCost, sellerStock, ozonStock }))).toEqual([
      { averagePurchaseCost: null, sellerStock: "0.000", ozonStock: "0.000" },
      { averagePurchaseCost: null, sellerStock: "0.000", ozonStock: "-1.000" },
    ]);
  });
});
