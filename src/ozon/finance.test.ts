import { describe, expect, it } from "vitest";
import { financeAccrualPostingNumber, financeAccrualRowContainsSku, financeRowContainsSku, matchBuyoutLines, postingContainsMarketplaceBuyout, staleOzonAccrualKeys } from "./finance";

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

describe("matchBuyoutLines", () => {
  const lines = [
    { id: "exact", offerId: "shared-offer", ozonSku: "100" },
    { id: "other-sku", offerId: "shared-offer", ozonSku: "200" },
  ];

  it("requires an exact SKU when the report includes one", () => {
    expect(matchBuyoutLines(lines, { sku: "missing", offerId: "shared-offer" })).toEqual([]);
    expect(matchBuyoutLines(lines, { sku: "100", offerId: "shared-offer" })).toEqual([lines[0]]);
  });

  it("uses offer ID only when SKU is absent and the match is unique", () => {
    expect(matchBuyoutLines(lines, { sku: "", offerId: "shared-offer" })).toEqual([]);
    expect(matchBuyoutLines(lines.slice(0, 1), { sku: "", offerId: "shared-offer" })).toEqual([lines[0]]);
  });
});

describe("staleOzonAccrualKeys", () => {
  it("reconciles only Ozon rows for the requested day after complete pagination", () => {
    expect(staleOzonAccrualKeys(
      "2026-10-20",
      ["legacy-sale:order-1:sku-1", "2026-10-20:POSTING:1:old:", "2026-10-19:POSTING:2:old:"],
      new Set(["2026-10-20:POSTING:3:seen:"]),
      true,
    )).toEqual(["2026-10-20:POSTING:1:old:"]);
  });

  it("keeps every existing row when pagination is incomplete", () => {
    expect(staleOzonAccrualKeys(
      "2026-10-20",
      ["2026-10-20:POSTING:1:old:"],
      new Set(),
      false,
    )).toEqual([]);
  });
});

describe("financeAccrualPostingNumber", () => {
  it("keeps posting and item accruals linked to their shipment", () => {
    expect(financeAccrualPostingNumber("POSTING", "post-1")).toBe("post-1");
    expect(financeAccrualPostingNumber("ITEM", "post-1")).toBe("post-1");
  });

  it("does not interpret account-level service IDs as shipments", () => {
    expect(financeAccrualPostingNumber("NON_ITEM", "campaign-1")).toBeNull();
  });
});
