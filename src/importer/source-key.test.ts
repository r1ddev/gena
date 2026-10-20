import { describe, expect, it } from "vitest";
import { makeImportSourceKey } from "./source-key";

describe("makeImportSourceKey", () => {
  it("is stable for the same file row and distinct for another file with the same row numbers", () => {
    const first = makeImportSourceKey("a".repeat(64), "row:Expenses:2");

    expect(makeImportSourceKey("a".repeat(64), "row:Expenses:2")).toBe(first);
    expect(makeImportSourceKey("b".repeat(64), "row:Expenses:2")).not.toBe(first);
    expect(makeImportSourceKey("a".repeat(64), "row:Expenses:3")).not.toBe(first);
  });
});
