import { describe, expect, it } from "vitest";
import { matchesOzonSupplyToLocalRecord } from "./supply-order-reconciliation";

describe("matchesOzonSupplyToLocalRecord", () => {
  it("matches a four digit supply reference when the Ozon SKU also matches", () => {
    expect(matchesOzonSupplyToLocalRecord({
      note: "7579",
      localSkus: ["3204354909"],
      orderNumber: "2000072717579",
      supplyId: "2000072717579",
      ozonSkus: [3204354909],
    })).toBe(true);
  });

  it("does not match by the four digit reference when the SKU differs", () => {
    expect(matchesOzonSupplyToLocalRecord({
      note: "7579",
      localSkus: ["3204354909"],
      orderNumber: "2000072717579",
      supplyId: "2000072717579",
      ozonSkus: [4141561644],
    })).toBe(false);
  });

  it("matches a full Ozon supply ID exactly", () => {
    expect(matchesOzonSupplyToLocalRecord({
      note: "Ozon ID 2000072717579",
      localSkus: ["3204354909"],
      orderNumber: "2000072717579",
      supplyId: "2000072717579",
      ozonSkus: ["3204354909"],
    })).toBe(true);
  });
});
