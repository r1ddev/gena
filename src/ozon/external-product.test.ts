import { describe, expect, it } from "vitest";
import { chooseExternalProductRecord, dispositionAfterProductLink, exactProductLinkForOffer, externalItemIgnorePlan, externalItemKeysToIgnore, resolveExternalProductLink } from "./external-product";

describe("chooseExternalProductRecord", () => {
  it("carries an ignored SKU across offer-id changes unless the exact key was explicitly resolved", () => {
    const ignored = { externalKey: "offer:old|sku:123", disposition: "ignored" as const, productId: null };
    const pendingExact = { externalKey: "offer:new|sku:123", disposition: "pending" as const, productId: null };
    const mappedExact = { externalKey: "offer:new|sku:123", disposition: "mapped" as const, productId: "p1" };

    expect(chooseExternalProductRecord(pendingExact, [pendingExact, ignored])).toBe(ignored);
    expect(chooseExternalProductRecord(mappedExact, [mappedExact, ignored])).toBe(mappedExact);
  });
});

describe("resolveExternalProductLink", () => {
  it("keeps an explicit ignore effective even when a product link still exists", () => {
    expect(resolveExternalProductLink("ignored", null, "linked-product")).toEqual({
      productId: null,
      ignored: true,
    });
  });

  it("uses saved mappings or product links for non-ignored items", () => {
    expect(resolveExternalProductLink("mapped", "saved-product", null)).toEqual({
      productId: "saved-product",
      ignored: false,
    });
    expect(resolveExternalProductLink("pending", null, "linked-product")).toEqual({
      productId: "linked-product",
      ignored: false,
    });
    expect(resolveExternalProductLink("pending", null, null)).toEqual({
      productId: null,
      ignored: false,
    });
  });
});

describe("exactProductLinkForOffer", () => {
  it("recognizes an explicit link for the exact offer and SKU only", () => {
    expect(exactProductLinkForOffer([
      { offerId: "old", ozonSku: "123", productId: "p1" },
      { offerId: "new", ozonSku: "456", productId: "p2" },
    ], "new", "123")).toBeUndefined();
    expect(exactProductLinkForOffer([
      { offerId: "new", ozonSku: null, productId: "p3" },
    ], "new", "123")).toBeUndefined();
    expect(exactProductLinkForOffer([
      { offerId: "new", ozonSku: "123", productId: "p4" },
    ], "new", "123")).toEqual({ offerId: "new", ozonSku: "123", productId: "p4" });
  });
});

describe("dispositionAfterProductLink", () => {
  it("clears a saved ignore when an explicit link resolves the external item", () => {
    expect(dispositionAfterProductLink("ignored")).toBe("mapped");
    expect(dispositionAfterProductLink("created")).toBe("created");
    expect(dispositionAfterProductLink("pending")).toBe("mapped");
  });
});

describe("externalItemKeysToIgnore", () => {
  it("includes unresolved historical sibling offer IDs but preserves explicit mappings", () => {
    expect(externalItemKeysToIgnore([
      { id: "selected", externalKey: "offer:old|sku:123", ozonSku: "123", disposition: "mapped" },
      { id: "pending", externalKey: "offer:new|sku:123", ozonSku: "123", disposition: "pending" },
      { id: "ignored", externalKey: "offer:older|sku:123", ozonSku: "123", disposition: "ignored" },
      { id: "mapped", externalKey: "offer:mapped|sku:123", ozonSku: "123", disposition: "mapped" },
      { id: "created", externalKey: "offer:created|sku:123", ozonSku: "123", disposition: "created" },
      { id: "other-sku", externalKey: "offer:other|sku:456", ozonSku: "456", disposition: "pending" },
    ], "selected")).toEqual(["offer:old|sku:123", "offer:new|sku:123", "offer:older|sku:123"]);
  });

  it("still includes the selected external key when its SKU is unavailable", () => {
    expect(externalItemKeysToIgnore([
      { id: "selected", externalKey: "offer:old|sku:", ozonSku: "", disposition: "pending" },
    ], "selected")).toEqual(["offer:old|sku:"]);
  });
});

describe("externalItemIgnorePlan", () => {
  it("clears inherited history and restores an explicitly resolved sibling offer", () => {
    expect(externalItemIgnorePlan([
      { id: "selected", externalKey: "offer:old|sku:123", ozonSku: "123", disposition: "ignored", productId: null },
      { id: "pending", externalKey: "offer:previously-linked|sku:123", ozonSku: "123", disposition: "pending", productId: null },
      { id: "mapped", externalKey: "offer:explicit|sku:123", ozonSku: "123", disposition: "mapped", productId: "p1" },
    ], "selected")).toEqual({
      keysToIgnore: ["offer:old|sku:123", "offer:previously-linked|sku:123"],
      mappingsToPreserve: [{ externalKey: "offer:explicit|sku:123", productId: "p1" }],
      financeProductId: "p1",
    });
  });

  it("does not guess a finance mapping when explicit sibling mappings conflict", () => {
    expect(externalItemIgnorePlan([
      { id: "selected", externalKey: "offer:old|sku:123", ozonSku: "123", disposition: "ignored", productId: null },
      { id: "mapped-a", externalKey: "offer:a|sku:123", ozonSku: "123", disposition: "mapped", productId: "p1" },
      { id: "mapped-b", externalKey: "offer:b|sku:123", ozonSku: "123", disposition: "created", productId: "p2" },
    ], "selected").financeProductId).toBeNull();
  });

  it("preserves history resolved by an exact product link without an external-item row", () => {
    expect(externalItemIgnorePlan([
      { id: "selected", externalKey: "offer:new|sku:123", ozonSku: "123", disposition: "pending", productId: null },
    ], "selected", [
      { externalKey: "offer:legacy|sku:123", productId: "p1" },
    ])).toEqual({
      keysToIgnore: ["offer:new|sku:123"],
      mappingsToPreserve: [{ externalKey: "offer:legacy|sku:123", productId: "p1" }],
      financeProductId: "p1",
    });
  });

  it("does not guess an item-accrual mapping when product links disagree", () => {
    expect(externalItemIgnorePlan([
      { id: "selected", externalKey: "offer:new|sku:123", ozonSku: "123", disposition: "pending", productId: null },
    ], "selected", [
      { externalKey: "offer:legacy-a|sku:123", productId: "p1" },
      { externalKey: "offer:legacy-b|sku:123", productId: "p2" },
    ]).financeProductId).toBeNull();
  });
});
