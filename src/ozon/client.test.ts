import { describe, expect, it } from "vitest";
import { ozonRequestWait, ozonRetryDelay } from "./client";

describe("ozonRetryDelay", () => {
  it("backs off for rate limits and honors the server retry-after value", () => {
    expect(ozonRetryDelay(0)).toBe(1_000);
    expect(ozonRetryDelay(1)).toBe(2_000);
    expect(ozonRetryDelay(0, "2")).toBe(2_000);
  });

  it("caps a long retry-after value and ignores invalid values", () => {
    expect(ozonRetryDelay(0, "100")).toBe(30_000);
    expect(ozonRetryDelay(2, "later")).toBe(4_000);
  });

  it("spaces consecutive API calls at least one second apart", () => {
    expect(ozonRequestWait(10_000, 10_500)).toBe(500);
    expect(ozonRequestWait(10_000, 11_000)).toBe(0);
  });
});
