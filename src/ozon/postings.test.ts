import { describe, expect, it } from "vitest";
import { observeBuyerHandoffAt, preserveMarketplaceBuyoutEvidence } from "./postings";

describe("observeBuyerHandoffAt", () => {
  it("records the first observation of the Delivered status as buyer handoff", () => {
    const observedAt = new Date("2026-10-20T02:00:00.000Z");

    expect(observeBuyerHandoffAt(null, "delivered", observedAt)).toEqual(observedAt);
  });

  it("does not record a handoff for a status before Delivered", () => {
    expect(observeBuyerHandoffAt(null, "delivering", new Date("2026-10-20T02:00:00.000Z"))).toBeNull();
  });

  it("preserves the first handoff time on later synchronizations", () => {
    const firstObservedAt = new Date("2026-10-19T10:00:00.000Z");

    expect(observeBuyerHandoffAt(firstObservedAt, "delivered", new Date("2026-10-20T02:00:00.000Z"))).toEqual(firstObservedAt);
  });
});

describe("preserveMarketplaceBuyoutEvidence", () => {
  it("keeps a financial-report buyout timestamp when an import is reapplied", () => {
    const marketplaceBuyoutAt = new Date("2026-10-10T00:00:00.000Z");
    expect(preserveMarketplaceBuyoutEvidence(false, { marketplaceBuyoutAt })).toEqual({
      isMarketplaceBuyout: true,
      marketplaceBuyoutAt,
    });
  });

  it("does not preserve an unconfirmed buyout classification without a report timestamp", () => {
    expect(preserveMarketplaceBuyoutEvidence(false, { marketplaceBuyoutAt: null })).toEqual({
      isMarketplaceBuyout: false,
      marketplaceBuyoutAt: null,
    });
  });

  it("keeps the imported classification when there is no prior evidence", () => {
    expect(preserveMarketplaceBuyoutEvidence(true, null)).toEqual({ isMarketplaceBuyout: true, marketplaceBuyoutAt: null });
  });
});
