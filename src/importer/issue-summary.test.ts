import { describe, expect, it } from "vitest";
import { summarizeImportIssues } from "./issue-summary";

describe("summarizeImportIssues", () => {
  it("counts every issue by its full validation message", () => {
    expect(summarizeImportIssues([
      { sheet: "Sales", row: 2, message: "Missing date" },
      { sheet: "Sales", row: 3, message: "Missing date" },
      { sheet: "Purchases", row: 4, message: "Unknown SKU" },
    ])).toEqual([
      { message: "Missing date", count: 2 },
      { message: "Unknown SKU", count: 1 },
    ]);
  });
});
