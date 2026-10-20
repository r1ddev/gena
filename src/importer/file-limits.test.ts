import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { assertXlsxExpandedSize, readRequestBodyWithinLimit } from "./file-limits";

describe("readRequestBodyWithinLimit", () => {
  it("reads request streams up to the configured limit", async () => {
    const request = new Request("http://localhost/import", { method: "POST", body: "small" });
    await expect(readRequestBodyWithinLimit(request, 5)).resolves.toEqual(Buffer.from("small"));
  });

  it("rejects oversized request streams and declared lengths", async () => {
    const streamed = new Request("http://localhost/import", { method: "POST", body: "too large" });
    const declared = new Request("http://localhost/import", { method: "POST", headers: { "content-length": "9" }, body: "small" });

    await expect(readRequestBodyWithinLimit(streamed, 5)).rejects.toThrow(/20 МБ|лимит/);
    await expect(readRequestBodyWithinLimit(declared, 5)).rejects.toThrow(/20 МБ|лимит/);
  });
});

describe("assertXlsxExpandedSize", () => {
  it("rejects a workbook whose expanded zip content exceeds the limit", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Data").addRow(["x".repeat(5000)]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(() => assertXlsxExpandedSize(bytes, 100)).toThrow(/распакованных данных/);
  });
});
