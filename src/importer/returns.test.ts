import { describe, expect, it } from "vitest";
import { getLegacyReturnWriteMode, mergeLegacyReturnReconciliation } from "./returns";

describe("getLegacyReturnWriteMode", () => {
  it("inserts a return when the identifier is not yet present", () => {
    expect(getLegacyReturnWriteMode(null)).toBe("insert");
  });

  it("updates a previous imported return when corrected data is imported", () => {
    expect(getLegacyReturnWriteMode({ source: "legacy-import" })).toBe("update");
  });

  it("never lets workbook import overwrite an Ozon API return", () => {
    expect(getLegacyReturnWriteMode({ id: 123, status: "Received" })).toBe("conflict");
    expect(getLegacyReturnWriteMode("invalid")).toBe("conflict");
  });
});

describe("mergeLegacyReturnReconciliation", () => {
  const receivedAt = new Date("2026-10-20T12:00:00.000Z");

  it("preserves manually reconciled fields when an import omits them", () => {
    expect(mergeLegacyReturnReconciliation({
      postingNumber: "posting-1",
      destination: "seller",
      receivedBySellerAt: receivedAt,
      availableAtOzon: null,
    }, {
      postingNumber: null,
      destination: "unknown",
      receivedBySellerAt: null,
      availableAtOzon: null,
    })).toEqual({
      postingNumber: "posting-1",
      destination: "seller",
      receivedBySellerAt: receivedAt,
      availableAtOzon: null,
    });
  });

  it("uses explicit imported reconciliation values when present", () => {
    const availableAt = new Date("2026-10-21T00:00:00.000Z");
    expect(mergeLegacyReturnReconciliation({
      postingNumber: "old-posting",
      destination: "seller",
      receivedBySellerAt: receivedAt,
      availableAtOzon: null,
    }, {
      postingNumber: "new-posting",
      destination: "ozon",
      receivedBySellerAt: null,
      availableAtOzon: availableAt,
    })).toEqual({
      postingNumber: "new-posting",
      destination: "ozon",
      receivedBySellerAt: receivedAt,
      availableAtOzon: availableAt,
    });
  });

  it("keeps fields the user manually reconciled when a reimport contains stale values", () => {
    const availableAt = new Date("2026-10-22T00:00:00.000Z");
    expect(mergeLegacyReturnReconciliation({
      postingNumber: "correct-posting",
      destination: "seller",
      receivedBySellerAt: receivedAt,
      availableAtOzon: null,
      manualReconciliationFields: ["postingNumber", "destination", "receivedBySellerAt"],
    }, {
      postingNumber: "stale-posting",
      destination: "ozon",
      receivedBySellerAt: null,
      availableAtOzon: availableAt,
    })).toEqual({
      postingNumber: "correct-posting",
      destination: "seller",
      receivedBySellerAt: receivedAt,
      availableAtOzon: availableAt,
    });
  });
});
