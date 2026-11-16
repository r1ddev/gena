import { describe, expect, it } from "vitest";
import { calculateProductProfitDays } from "./product-profit-trend";

describe("calculateProductProfitDays", () => {
  it("calculates the main line with shared average cost and returns historical cost for comparison", () => {
    const result = calculateProductProfitDays({
      saleDays: [{ postingId: "posting-1", date: "2026-10-06" }],
      items: [{ postingId: "posting-1", productId: "pink", quantity: 1, price: 220 }],
      accruals: [{ postingId: "posting-1", amount: 150, sourceGroup: "orders", category: "POSTING" }],
      now: new Date("2026-10-07T00:00:00.000Z"),
      returns: [],
      averageUnitCostByProduct: new Map([["pink", "100"]]),
      saleCostsByPostingProduct: new Map([["posting-1\u0000pink", { quantity: "1", unitLandedCost: "120" }]]),
    });

    expect(result).toEqual([{
      date: "2026-10-06",
      productId: "pink",
      profitCents: 5000,
      units: 1,
      historicalProfitCents: 3000,
      historicalUnits: 1,
    }]);
  });

  it("keeps the shared-average profit when the historical-cost variant is not positive", () => {
    const result = calculateProductProfitDays({
      saleDays: [{ postingId: "posting-1", date: "2026-10-06" }],
      items: [{ postingId: "posting-1", productId: "pink", quantity: 1, price: 220 }],
      accruals: [{ postingId: "posting-1", amount: 150, sourceGroup: "orders", category: "POSTING" }],
      now: new Date("2026-10-07T00:00:00.000Z"),
      returns: [],
      averageUnitCostByProduct: new Map([["pink", "100"]]),
      saleCostsByPostingProduct: new Map([["posting-1\u0000pink", { quantity: "1", unitLandedCost: "200" }]]),
    });

    expect(result).toEqual([{
      date: "2026-10-06",
      productId: "pink",
      profitCents: 5000,
      units: 1,
      historicalProfitCents: null,
      historicalUnits: 0,
    }]);
  });
});
