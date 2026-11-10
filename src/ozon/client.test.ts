import { describe, expect, it } from "vitest";
import { ozonRequestWait, ozonRetryDelay } from "./client";

describe("ozonRetryDelay", () => {
  it("backs off for rate limits and honors the server retry-after value", () => {
    expect(ozonRetryDelay(0)).toBe(2_000);
    expect(ozonRetryDelay(1)).toBe(4_000);
    expect(ozonRetryDelay(0, "2")).toBe(2_000);
  });

  it("honors a long retry-after value and ignores invalid values", () => {
    expect(ozonRetryDelay(0, "100")).toBe(100_000);
    expect(ozonRetryDelay(2, "later")).toBe(8_000);
  });

  it("accepts the HTTP-date form of retry-after", () => {
    const now = new Date("2026-10-20T12:00:00.000Z").getTime();
    expect(ozonRetryDelay(0, "Tue, 20 Oct 2026 12:00:02 GMT", now)).toBe(2_000);
  });

  it("spaces consecutive API calls at least two seconds apart", () => {
    expect(ozonRequestWait(10_000, 10_500)).toBe(1_500);
    expect(ozonRequestWait(10_000, 11_000)).toBe(1_000);
  });
});
