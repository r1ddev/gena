import { describe, expect, it } from "vitest";
import { resolveOzonReturnTimeline } from "./return-status";

describe("resolveOzonReturnTimeline", () => {
  it("uses Ozon's status-change time when the item is received by the seller", () => {
    expect(resolveOzonReturnTimeline({
      visual: { status: { sys_name: "ReceivedBySeller" }, change_moment: "2026-01-11T16:20:03.220Z" },
      logistic: { final_moment: "2026-01-11T16:20:03.220Z" },
    })).toEqual({
      finalStatus: "seller",
      receivedBySellerAt: new Date("2026-01-11T16:20:03.220Z"),
      availableAtOzon: null,
      writtenOffAt: null,
    });
  });

  it("uses Ozon's status-change time when the item is returned to its warehouse", () => {
    expect(resolveOzonReturnTimeline({
      visual: { status: { sys_name: "ReturnedToOzon" }, change_moment: "2026-01-25T08:30:00.000Z" },
    })).toEqual({
      finalStatus: "ozon",
      receivedBySellerAt: null,
      availableAtOzon: new Date("2026-01-25T08:30:00.000Z"),
      writtenOffAt: null,
    });
  });

  it("does not treat an intermediate return status as a completed receipt", () => {
    expect(resolveOzonReturnTimeline({
      visual: { status: { sys_name: "MovingToSeller" }, change_moment: "2026-01-25T08:30:00.000Z" },
    })).toEqual({
      finalStatus: null,
      receivedBySellerAt: null,
      availableAtOzon: null,
      writtenOffAt: null,
    });
  });

  it("uses the final moment for an Ozon write-off when no change moment is present", () => {
    expect(resolveOzonReturnTimeline({
      visual: { status: { sys_name: "WriteOff" } },
      logistic: { final_moment: "2026-01-26T09:00:00.000Z" },
    })).toEqual({
      finalStatus: "writeoff",
      receivedBySellerAt: null,
      availableAtOzon: null,
      writtenOffAt: new Date("2026-01-26T09:00:00.000Z"),
    });
  });
});
