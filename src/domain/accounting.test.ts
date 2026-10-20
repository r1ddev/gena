import { describe, expect, it } from "vitest";
import { calculateAccounting, hasAccountablePostingItems, type AccountingInput } from "./accounting";

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
  it("enables a posting only when it has a mapped item and every unknown item is resolved or ignored", () => {
    expect(hasAccountablePostingItems([
      { productId: "p1" },
      { productId: null, ignored: true },
    ])).toBe(true);
    expect(hasAccountablePostingItems([
      { productId: "p1" },
      { productId: null },
    ])).toBe(false);
    expect(hasAccountablePostingItems([{ productId: null, ignored: true }])).toBe(false);
  });

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

    expect(result.sharedExpenseCoefficient).toBe("0.2000");
    expect(result.products[0].landedUnitCost).toBe("60.00");
    expect(result.cashBalance).toBe("180.00");
    expect(result.confirmedProfit).toBe("240.00");
  });

  it("shows small shared cost ratios without rounding them to zero", () => {
    const result = calculateAccounting(
      base({ expenses: [{ amount: "0.40" }] }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.sharedExpenseCoefficient).toBe("0.0040");
    expect(result.products[0].landedUnitCost).toBe("50.20");
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

  it("recognizes only the marketplace-buyout item early when an order contains mixed sale types", () => {
    const result = calculateAccounting(
      base({
        products: [
          { id: "p1", sku: "BAG-1", title: "Сумка" },
          { id: "p2", sku: "BAG-2", title: "Кошелёк" },
        ],
        purchases: [{ id: "purchase-1", amountPaid: "200" }],
        receipts: [
          { productId: "p1", quantity: "1", unitCost: "50", receivedAt: "2026-10-01" },
          { productId: "p2", quantity: "1", unitCost: "50", receivedAt: "2026-10-01" },
        ],
        supplies: [
          { productId: "p1", quantity: "1", shippingCost: "0", suppliedAt: "2026-10-01" },
          { productId: "p2", quantity: "1", shippingCost: "0", suppliedAt: "2026-10-01" },
        ],
        postings: [{ id: "mixed", status: "delivered", deliveredAt: "2026-10-18T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [
          { postingId: "mixed", productId: "p1", quantity: "1", price: "120", isMarketplaceBuyout: true, marketplaceBuyoutAt: "2026-10-20T09:00:00Z" } as AccountingInput["postingItems"][number],
          { postingId: "mixed", productId: "p2", quantity: "1", price: "300", isMarketplaceBuyout: false } as AccountingInput["postingItems"][number],
        ],
        financeAccruals: [
          { postingId: "mixed", productId: "p1", amount: "120", category: "ITEM", accrualDate: "2026-10-20" },
          { postingId: "mixed", amount: "300", category: "POSTING", accrualDate: "2026-10-20" },
        ],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-80.00");
    expect(result.confirmedProfit).toBe("70.00");
    expect(result.unrecognizedFinanceAmount).toBe("300.00");
    expect(result.recognizedPostingIds).toEqual([]);
    expect(result.preliminaryOrders).toMatchObject({ count: 1, grossAmount: "300.00" });
  });

  it("adds a seller return to the seller stock only after it is received", () => {
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

  it("does not reverse COGS or stock before a return becomes effective", () => {
    const input = base({
      purchases: [{ id: "purchase-1", amountPaid: "50" }],
      receipts: [{ productId: "p1", quantity: "1", unitCost: "50", receivedAt: "2026-09-01" }],
      supplies: [{ productId: "p1", quantity: "1", shippingCost: "0", suppliedAt: "2026-09-02" }],
      postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-10T10:00:00Z", isMarketplaceBuyout: false }],
      postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
      financeAccruals: [{ postingId: "post-1", amount: "300" }],
      returns: [{ postingId: "post-1", productId: "p1", quantity: "1", destination: "seller", receivedBySellerAt: "2026-10-21T10:00:00Z", availableAtOzon: null }],
    });

    const before = calculateAccounting(input, new Date("2026-10-20T12:00:00Z"));
    const after = calculateAccounting(input, new Date("2026-10-21T12:00:00Z"));

    expect(before.products[0].sellerStock).toBe("0.000");
    expect(before.confirmedProfit).toBe("250.00");
    expect(after.products[0].sellerStock).toBe("1.000");
    expect(after.confirmedProfit).toBe("300.00");
  });

  it("does not restore an Ozon return for a posting that was never delivered", () => {
    const result = calculateAccounting(
      base({
        receipts: [{ productId: "p1", quantity: "10", unitCost: "50" }],
        supplies: [{ productId: "p1", quantity: "10", shippingCost: "0" }],
        postings: [{ id: "cancelled", status: "cancelled", deliveredAt: null, isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "cancelled", productId: "p1", quantity: "1", price: "300" }],
        returns: [{ postingId: "cancelled", productId: "p1", quantity: "1", destination: "ozon", receivedBySellerAt: null, availableAtOzon: "2026-10-20T10:00:00Z" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0].ozonStock).toBe("10.000");
  });

  it("does not move stock again when a delivered order is returned to Ozon", () => {
    const result = calculateAccounting(
      base({
        receipts: [{ productId: "p1", quantity: "1", unitCost: "50" }],
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "0" }],
        postings: [{ id: "returned", status: "delivered", deliveredAt: "2026-10-01T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "returned", productId: "p1", quantity: "1", price: "300" }],
        returns: [{ postingId: "returned", productId: "p1", quantity: "1", destination: "ozon", receivedBySellerAt: null, availableAtOzon: "2026-10-10T10:00:00Z" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0].sellerStock).toBe("0.000");
    expect(result.products[0].ozonStock).toBe("0.000");
  });

  it("does not restore more units than were removed by the linked posting", () => {
    const result = calculateAccounting(
      base({
        receipts: [{ productId: "p1", quantity: "1", unitCost: "50" }],
        supplies: [{ productId: "p1", quantity: "1", shippingCost: "0", suppliedAt: "2026-09-02" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-10T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
        returns: [{ externalId: "return-overage", postingId: "post-1", productId: "p1", quantity: "2", destination: "seller", receivedBySellerAt: "2026-10-01T10:00:00Z", availableAtOzon: null }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0].sellerStock).toBe("1.000");
    expect(result.products[0].ozonStock).toBe("0.000");
    expect(result.profitReconciliationIssues).toEqual([
      { externalId: "return-overage", productId: "p1", sku: "BAG-1" },
    ]);
    expect(result.confirmedProfit).toBeNull();
  });

  it("does not use future receipts or future seller writeoffs in today's cost and profit", () => {
    const input = base({
      purchases: [{ id: "purchase-1", amountPaid: "150" }],
      receipts: [
        { productId: "p1", quantity: "1", unitCost: "50", receivedAt: "2026-10-01" },
        { productId: "p1", quantity: "1", unitCost: "100", receivedAt: "2026-10-21" },
      ],
      manualWriteoffs: [{ productId: "p1", quantity: "1", writtenOffAt: "2026-10-21" }],
    });

    const before = calculateAccounting(input, new Date("2026-10-20T12:00:00Z"));
    const after = calculateAccounting(input, new Date("2026-10-22T12:00:00Z"));

    expect(before.products[0].averagePurchaseCost).toBe("50.00");
    expect(before.products[0].sellerStock).toBe("1.000");
    expect(before.confirmedProfit).toBe("0.00");
    expect(after.products[0].averagePurchaseCost).toBe("75.00");
    expect(after.products[0].sellerStock).toBe("1.000");
    expect(after.confirmedProfit).toBe("-75.00");
  });

  it("does not apply future expenses to today's cash or landed cost", () => {
    const input = base({
      expenses: [{ amount: "10", spentAt: "2026-10-21" }],
    });

    const before = calculateAccounting(input, new Date("2026-10-20T12:00:00Z"));
    const after = calculateAccounting(input, new Date("2026-10-22T12:00:00Z"));

    expect(before.cashBalance).toBe("-100.00");
    expect(before.products[0].landedUnitCost).toBe("50.00");
    expect(after.cashBalance).toBe("-110.00");
    expect(after.products[0].landedUnitCost).toBe("55.00");
  });

  it("does not recognize an Ozon writeoff without an effective date", () => {
    const result = calculateAccounting(
      base({ ozonWriteoffs: [{ productId: "p1", quantity: "1", occurredAt: null }] }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.confirmedProfit).toBe("0.00");
    expect(result.products[0].ozonStock).toBe("0.000");
  });

  it("recognizes Ozon compensation from finance accruals exactly once against the writeoff cost", () => {
    const result = calculateAccounting(
      base({
        purchases: [{ id: "purchase-1", amountPaid: "100" }],
        receipts: [{ productId: "p1", quantity: "2", unitCost: "50" }],
        supplies: [{ productId: "p1", quantity: "2", shippingCost: "0" }],
        financeAccruals: [{
          postingId: null,
          productId: null,
          amount: "80",
          category: "NON_ITEM",
          isOzonWriteoffCompensation: true,
        }],
        ozonWriteoffs: [{
          productId: "p1",
          quantity: "1",
          occurredAt: "2026-10-15T12:00:00Z",
          compensationStatus: "COMPENSATION",
          compensationAmount: "80",
        }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-20.00");
    expect(result.confirmedProfit).toBe("30.00");
    expect(result.cashBreakdown.ozonWriteoffCompensation).toBe("80.00");
    expect(result.cashBreakdown.recognizedOzonOther).toBe("0.00");
    expect(result.profitBreakdown.ozonWriteoffCompensation).toBe("80.00");
    expect(result.products[0].ozonStock).toBe("1.000");
  });

  it("does not recognize compensation belonging to an explicitly ignored SKU", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const baseline = calculateAccounting(base(), now);
    const result = calculateAccounting(base({
      financeAccruals: [{
        postingId: null,
        productId: null,
        ozonSku: "IGNORED-SKU",
        amount: "60",
        category: "ITEM",
        isOzonWriteoffCompensation: true,
        ignored: true,
      }],
    }), now);

    expect(result.cashBalance).toBe(baseline.cashBalance);
    expect(result.confirmedProfit).toBe(baseline.confirmedProfit);
    expect(result.unrecognizedFinanceAmount).toBe("60.00");
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

  it("accounts for mapped lines when a different posting line is explicitly ignored", () => {
    const result = calculateAccounting(base({
      products: [
        { id: "p1", sku: "BAG-1", title: "Сумка" },
        { id: "p2", sku: "UNKNOWN-2", title: "Неизвестный товар" },
      ],
      purchases: [{ id: "purchase-1", amountPaid: "30" }],
      receipts: [{ productId: "p1", quantity: "1", unitCost: "30" }],
      postings: [{ id: "mixed", status: "delivered", deliveredAt: "2026-09-01T10:00:00Z", isMarketplaceBuyout: false, accountingEnabled: true }],
      postingItems: [
        { postingId: "mixed", productId: "p1", quantity: "1", price: "100", ozonSku: "KNOWN" },
        { postingId: "mixed", productId: null, quantity: "1", price: "500", ozonSku: "IGNORED", ignored: true },
      ],
      financeAccruals: [
        { postingId: "mixed", productId: "p1", ozonSku: "KNOWN", amount: "90", category: "ITEM" },
        { postingId: "mixed", productId: null, ozonSku: "IGNORED", amount: "400", category: "ITEM" },
        { postingId: "mixed", amount: "-10", category: "NON_ITEM" },
      ],
    }), new Date("2026-10-20T12:00:00Z"));

    expect(result.cashBalance).toBe("50.00");
    expect(result.confirmedProfit).toBe("50.00");
    expect(result.products.map(({ sku, ozonStock }) => [sku, ozonStock])).toEqual([
      ["BAG-1", "-1.000"],
      ["UNKNOWN-2", "0.000"],
    ]);
    expect(result.unrecognizedFinanceAmount).toBe("400.00");
  });

  it("excludes an ignored item accrual from a cancelled mixed posting", () => {
    const result = calculateAccounting(base({
      purchases: [],
      postings: [{ id: "cancelled", status: "cancelled", deliveredAt: null, isMarketplaceBuyout: false, accountingEnabled: true }],
      postingItems: [
        { postingId: "cancelled", productId: "p1", quantity: "1", price: "100", ozonSku: "KNOWN" },
        { postingId: "cancelled", productId: null, quantity: "1", price: "500", ozonSku: "IGNORED", ignored: true },
      ],
      financeAccruals: [
        { postingId: "cancelled", productId: "p1", ozonSku: "KNOWN", amount: "-5", category: "ITEM" },
        { postingId: "cancelled", productId: null, ozonSku: "IGNORED", amount: "-90", category: "ITEM" },
        { postingId: "cancelled", productId: null, ozonSku: "MISSING", amount: "-8", category: "ITEM" },
        { postingId: "cancelled", amount: "-10", category: "POSTING" },
      ],
    }), new Date("2026-10-20T12:00:00Z"));

    expect(result.cashBalance).toBe("-15.00");
    expect(result.unrecognizedFinanceAmount).toBe("-98.00");
  });

  it("recognizes legacy item finance only for lines whose status permits stock movement", () => {
    const result = calculateAccounting(base({
      products: [
        { id: "p1", sku: "BAG-1", title: "Сумка" },
        { id: "p2", sku: "BAG-2", title: "Кошелёк" },
      ],
      purchases: [{ id: "purchase-1", amountPaid: "50" }],
      receipts: [
        { productId: "p1", quantity: "1", unitCost: "30" },
        { productId: "p2", quantity: "1", unitCost: "20" },
      ],
      postings: [{ id: "mixed-status", status: "delivered", deliveredAt: "2026-09-01T10:00:00Z", isMarketplaceBuyout: false, accountingEnabled: true }],
      postingItems: [
        { postingId: "mixed-status", productId: "p1", quantity: "1", price: "100", movementEnabled: true },
        { postingId: "mixed-status", productId: "p2", quantity: "1", price: "400", movementEnabled: false },
      ],
      financeAccruals: [
        { postingId: "mixed-status", productId: "p1", amount: "100", category: "ITEM" },
        { postingId: "mixed-status", productId: "p2", amount: "400", category: "ITEM" },
      ],
    }), new Date("2026-10-20T12:00:00Z"));

    expect(result.cashBalance).toBe("50.00");
    expect(result.confirmedProfit).toBe("70.00");
    expect(result.unrecognizedFinanceAmount).toBe("400.00");
    expect(result.products.map(({ sku, ozonStock }) => [sku, ozonStock])).toEqual([
      ["BAG-1", "-1.000"],
      ["BAG-2", "0.000"],
    ]);
  });

  it("does not present profit as final when a sold item has no received cost basis", () => {
    const result = calculateAccounting(
      base({
        purchases: [],
        receipts: [],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-01T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.confirmedProfit).toBeNull();
    expect(result.profitBreakdown.total).toBeNull();
    expect(result.products[0].landedUnitCost).toBeNull();
    expect(result.costingIssues).toEqual([{ productId: "p1", sku: "BAG-1", title: "Сумка" }]);
  });

  it("does not treat a received batch with zero value as a known zero-cost basis", () => {
    const result = calculateAccounting(
      base({
        receipts: [{ productId: "p1", quantity: "1", unitCost: "0" }],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-09-01T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [{ postingId: "post-1", amount: "300" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.confirmedProfit).toBeNull();
    expect(result.products[0].averagePurchaseCost).toBeNull();
    expect(result.costingIssues).toHaveLength(1);
  });

  it("does not invent expected profit for a preliminary sale without a cost basis", () => {
    const result = calculateAccounting(
      base({
        purchases: [],
        receipts: [],
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-10-18T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.preliminaryOrders.expectedProfit).toBeNull();
    expect(result.costingIssues).toHaveLength(1);
  });

  it("excludes a delivered posting until every unmapped item is mapped or explicitly ignored", () => {
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

  it("does not include finance accruals dated after the accounting date", () => {
    const result = calculateAccounting(
      base({
        financeAccruals: [
          { postingId: null, productId: "p1", amount: "300", category: "ITEM", accrualDate: "2026-10-21" },
        ],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-100.00");
    expect(result.confirmedProfit).toBe("0.00");
    expect(result.unrecognizedFinanceAmount).toBe("300.00");
  });

  it("restocks a received mapped return without a posting and flags profit for reconciliation", () => {
    const result = calculateAccounting(
      base({
        returns: [{
          externalId: "return-without-posting",
          postingId: null,
          productId: "p1",
          quantity: "1",
          destination: "seller",
          returnedAt: "2026-10-10T00:00:00Z",
          receivedBySellerAt: "2026-10-20T00:00:00Z",
          availableAtOzon: null,
        }],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.products[0].sellerStock).toBe("3.000");
    expect(result.profitReconciliationIssues).toEqual([
      { externalId: "return-without-posting", productId: "p1", sku: "BAG-1" },
    ]);
    expect(result.confirmedProfit).toBeNull();
    expect(result.profitBreakdown.total).toBeNull();
  });

  it("keeps per-item charges tied to a delivered posting preliminary until the 21-day recognition point", () => {
    const result = calculateAccounting(
      base({
        postings: [{ id: "post-1", status: "delivered", deliveredAt: "2026-10-18T10:00:00Z", isMarketplaceBuyout: false }],
        postingItems: [{ postingId: "post-1", productId: "p1", quantity: "1", price: "300" }],
        financeAccruals: [
          { postingId: "post-1", amount: "300", category: "POSTING" },
          { postingId: "post-1", productId: "p1", amount: "-5", category: "ITEM" },
        ],
      }),
      new Date("2026-10-20T12:00:00Z"),
    );

    expect(result.cashBalance).toBe("-100.00");
    expect(result.unrecognizedFinanceAmount).toBe("295.00");
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
      recognizedOzonOther: "300.00",
      ozonWriteoffCompensation: "0.00",
      purchases: "-100.00",
      expenses: "-10.00",
      supplyShipping: "-10.00",
      total: "180.00",
    });
    expect(result.profitBreakdown).toEqual({
      recognizedOzon: "300.00",
      recognizedOzonOther: "300.00",
      ozonWriteoffCompensation: "0.00",
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
    expect(result.confirmedProfit).toBeNull();
    expect(result.costingIssues).toHaveLength(1);
    expect(result.unrecognizedFinanceAmount).toBe("98.00");
    expect(result.preliminaryOrders.count).toBe(0);
    expect(result.products.map(({ averagePurchaseCost, sellerStock, ozonStock }) => ({ averagePurchaseCost, sellerStock, ozonStock }))).toEqual([
      { averagePurchaseCost: null, sellerStock: "0.000", ozonStock: "0.000" },
      { averagePurchaseCost: null, sellerStock: "0.000", ozonStock: "-1.000" },
    ]);
  });
});
