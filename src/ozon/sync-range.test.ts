import { describe, expect, it } from "vitest";
import { isValidHistoryStartDate, resolveOzonSyncRange, splitUtcDateRange } from "./sync-range";

describe("resolveOzonSyncRange", () => {
  const startDate = "2025-10-20";
  const now = new Date("2026-10-20T12:00:00.000Z");

  it("starts the initial sync from the configured date", () => {
    expect(resolveOzonSyncRange(startDate, null, now)).toEqual({
      from: new Date("2025-10-20T00:00:00.000Z"),
      to: now,
    });
  });

  it("keeps the 45-day overlap but never goes before the configured date", () => {
    expect(resolveOzonSyncRange(startDate, new Date("2025-11-01T12:00:00.000Z"), now).from)
      .toEqual(new Date("2025-10-20T00:00:00.000Z"));
    expect(resolveOzonSyncRange(startDate, new Date("2026-01-01T12:00:00.000Z"), now).from)
      .toEqual(new Date("2025-11-17T00:00:00.000Z"));
  });

  it("accepts real calendar dates through today only", () => {
    expect(isValidHistoryStartDate("2025-02-28", now)).toBe(true);
    expect(isValidHistoryStartDate("2025-02-30", now)).toBe(false);
    expect(isValidHistoryStartDate("2026-10-21", now)).toBe(false);
  });
});

describe("splitUtcDateRange", () => {
  it("splits a long history into inclusive UTC ranges without gaps or overlaps", () => {
    const ranges = splitUtcDateRange(new Date("2025-01-15T00:00:00.000Z"), new Date("2026-02-01T12:00:00.000Z"), 365);

    expect(ranges).toEqual([
      { from: new Date("2025-01-15T00:00:00.000Z"), to: new Date("2026-01-14T23:59:59.999Z") },
      { from: new Date("2026-01-15T00:00:00.000Z"), to: new Date("2026-02-01T12:00:00.000Z") },
    ]);
  });

  it("returns no ranges when the configured start is after now", () => {
    expect(splitUtcDateRange(new Date("2026-10-21T00:00:00.000Z"), new Date("2026-10-20T12:00:00.000Z"), 365)).toEqual([]);
  });
});
