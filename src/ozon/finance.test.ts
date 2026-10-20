import { describe, expect, it } from "vitest";
import { financeAccrualRowContainsSku, financeRowContainsSku, postingContainsMarketplaceBuyout } from "./finance";

describe("financeRowContainsSku", () => {
  it("matches the exact Ozon SKU in ITEM fees", () => {
    expect(financeRowContainsSku({ item_fees: { fees: [{ sku: "12345", fees: [] }] } }, "12345")).toBe(true);
  });

  it("does not match a different or missing SKU", () => {
    const raw = { item_fees: { fees: [{ sku: "123456", fees: [] }] } };
    expect(financeRowContainsSku(raw, "12345")).toBe(false);
    expect(financeRowContainsSku({}, "12345")).toBe(false);
  });
});

describe("financeAccrualRowContainsSku", () => {
  it("matches only the SKU represented by a split accrual row key", () => {
    const raw = { item_fees: { fees: [{ sku: "A-1", fees: [{ accrued: "-10" }] }, { sku: "B-2", fees: [{ accrued: "-20" }] }] } };

    expect(financeAccrualRowContainsSku("2026-01-01:ITEM:123:abc:sku:A-1", raw, "A-1")).toBe(true);
    expect(financeAccrualRowContainsSku("2026-01-01:ITEM:123:abc:sku:A-1", raw, "B-2")).toBe(false);
    expect(financeAccrualRowContainsSku("2026-01-01:ITEM:123:abc:sku:B-2", raw, "B-2")).toBe(true);
    expect(financeAccrualRowContainsSku("2026-01-01:ITEM:123:abc:sku:B-2", raw, "A-1")).toBe(false);
  });

  it("does not confuse an SKU with a longer SKU sharing its prefix", () => {
    const raw = { item_fees: { fees: [{ sku: "123456", fees: [{ accrued: "-10" }] }] } };
    expect(financeAccrualRowContainsSku("2026-01-01:ITEM:123:abc:sku:123456", raw, "12345")).toBe(false);
  });
});

describe("postingContainsMarketplaceBuyout", () => {
  it("classifies a posting from Ozon's explicit product marker", () => {
    expect(postingContainsMarketplaceBuyout({ products: [{ is_marketplace_buyout: true }] })).toBe(true);
  });

  it("does not infer a buyout from price, status, or missing markers", () => {
    expect(postingContainsMarketplaceBuyout({ products: [{ is_marketplace_buyout: false, price: "-10" }] })).toBe(false);
    expect(postingContainsMarketplaceBuyout({ products: [{ price: "-10" }] })).toBe(false);
    expect(postingContainsMarketplaceBuyout({ products: "invalid" })).toBe(false);
  });
});
