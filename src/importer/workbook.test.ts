import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { classifyImportSheet, getImportCellValue, getSupplyShippingCost, parseImportBuffer, parseImportDate, parseImportMoney } from "./workbook";

describe("workbook import helpers", () => {
  it("finds legacy values using the actual sheet labels after normalization", () => {
    const cells = { "что": "Бумага для штрихкодов", "стоимрасходов": 376, "дата": "2026-10-20T11:30:00Z" };
    expect(getImportCellValue(cells, ["категория", "что"])).toBe("Бумага для штрихкодов");
    expect(getImportCellValue(cells, ["стоимость расходов", "стоим расходов"])).toBe(376);
    expect(getImportCellValue(cells, ["дата доставки", "дата"])).toBe("2026-10-20T11:30:00Z");
  });

  it("prefers the named supply cost over a later numeric quantity column", () => {
    expect(getSupplyShippingCost({
      headers: ["Дата", "Артикул", "Стоим Расходов", "Количество"],
      cells: { "дата": "2026-10-20", "артикул": "A-1", "стоимрасходов": 500, "количество": 10 },
      values: ["2026-10-20", "A-1", 500, 10],
    })).toBe(500);
  });

  it("uses positional supply cost only for the recognized legacy expense-description layout", () => {
    expect(getSupplyShippingCost({
      headers: ["Дата", "Артикул", "Расходы", "Сумма"],
      cells: { "дата": "2026-10-20", "артикул": "A-1", "расходы": "Cross-dock", "сумма": 500 },
      values: ["2026-10-20", "A-1", "Cross-dock", 500],
    })).toBe(500);
    expect(getSupplyShippingCost({
      headers: ["Дата", "Номер поставки", "Расходы", "Сумма"],
      cells: { "дата": "2026-10-20", "номерпоставки": "S-1", "расходы": "Доставка № 123", "сумма": 500 },
      values: ["2026-10-20", "S-1", "Доставка № 123", 500],
    })).toBe(500);
    expect(getSupplyShippingCost({
      headers: ["Дата", "Артикул", "Расходы", "Количество"],
      cells: { "дата": "2026-10-20", "артикул": "A-1", "расходы": "Cross-dock", "количество": 10 },
      values: ["2026-10-20", "A-1", "Cross-dock", 10],
    })).toBe(0);
  });

  it("classifies operation sheets from their name and falls back to headers", () => {
    expect(classifyImportSheet("Расходы", ["Дата", "Категория", "Сумма"])).toBe("expenses");
    expect(classifyImportSheet("Sheet 1", ["SKU", "Наименование", "Размер"])).toBe("products");
    expect(classifyImportSheet("Sheet 2", ["Дата", "Артикул", "Статус", "Сумма"])).toBe("sales");
    expect(classifyImportSheet("Sheet 3", ["Что-то", "Непонятно"])).toBe("unknown");
  });

  it.each([
    ["Закупки", "purchases"], ["Поставки", "supplies"], ["Продажи", "sales"],
    ["Возвраты", "returns"], ["Инвентаризация", "stocktakes"], ["Списания", "writeoffs"],
  ] as const)("classifies a %s sheet", (sheetName, expected) => {
    expect(classifyImportSheet(sheetName, [])).toBe(expected);
  });

  it("reads xlsx formulas by their cached result and keeps duplicate columns", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Расходы");
    sheet.addRow(["Дата", "Расход", "Расход"]);
    sheet.addRow([new Date("2026-01-02T00:00:00Z"), "упаковка", { formula: "10+5", result: 15 }]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseImportBuffer(buffer, "expenses.xlsx");

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].type).toBe("expenses");
    expect(parsed.rows[0].data.cells).toMatchObject({
      "дата": "2026-01-02T00:00:00.000Z",
      "расход": "упаковка",
      "расход__2": 15,
    });
  });

  it("parses quoted semicolon CSV, localized money, and common dates", async () => {
    const parsed = await parseImportBuffer(Buffer.from('SKU;Наименование;Цена\nA-1;"Сумка; чёрная";"1 234,50"', "utf8"), "items.csv");
    expect(parsed.rows[0].data.cells["наименование"]).toBe("Сумка; чёрная");
    expect(parseImportMoney("1 234,50 ₽")).toBe(1234.5);
    expect(parseImportDate("20.10.2026")).toBe("2026-10-20");
    expect(parseImportDate("2026-10-20T11:30:00Z")).toBe("2026-10-20");
  });

  it("parses BOM, comma CSV, escaped quotes, multiline fields, and skips blank rows", async () => {
    const csv = '\uFEFFSKU,Наименование,Примечание\r\nA-1,"Сумка ""Чёрная""","первая строка,\nвторая строка"\r\n,,\r\n';
    const parsed = await parseImportBuffer(Buffer.from(csv, "utf8"), "catalog.csv");

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].data.cells).toMatchObject({
      "наименование": 'Сумка "Чёрная"',
      "примечание": "первая строка,\nвторая строка",
    });
  });

  it("extracts rich text and hyperlink display values from xlsx cells", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Каталог");
    sheet.addRow(["SKU", "Наименование", "Ссылка"]);
    sheet.addRow([
      "A-1",
      { richText: [{ text: "Сумка" }, { text: " чёрная" }] },
      { text: "Карточка", hyperlink: "https://example.test/product" },
    ]);
    const parsed = await parseImportBuffer(Buffer.from(await workbook.xlsx.writeBuffer()), "catalog.xlsx");

    expect(parsed.rows[0].data.cells).toMatchObject({ "наименование": "Сумка чёрная", "ссылка": "Карточка" });
  });

  it("returns a clear error for unsupported, blank, and empty workbooks", async () => {
    await expect(parseImportBuffer(Buffer.from("x"), "file.txt")).rejects.toThrow("Поддерживаются");
    await expect(parseImportBuffer(Buffer.from(""), "empty.csv")).rejects.toThrow("не найдены строки");
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Пусто");
    await expect(parseImportBuffer(Buffer.from(await workbook.xlsx.writeBuffer()), "empty.xlsx")).rejects.toThrow("не найдены строки");
  });

  it("parses supported money formats and safely rejects invalid values", () => {
    expect(parseImportMoney(12.5)).toBe(12.5);
    expect(parseImportMoney(Number.NaN)).toBeNull();
    expect(parseImportMoney(null)).toBeNull();
    expect(parseImportMoney("1,234.56")).toBe(1234.56);
    expect(parseImportMoney("12 ₽")).toBe(12);
    expect(parseImportMoney("рублей")).toBeNull();
  });

  it("parses Excel serial dates and uses a fallback only when explicitly supplied", () => {
    expect(parseImportDate(46_000)).toBe("2025-12-09");
    expect(parseImportDate(10)).toBeNull();
    expect(parseImportDate("")).toBeNull();
    expect(parseImportDate("", "2026-01-02")).toBe("2026-01-02");
    expect(parseImportDate(new Date("invalid"))).toBeNull();
  });

  it("rejects impossible dates instead of aborting a whole import transaction", () => {
    expect(parseImportDate("2026-02-31")).toBeNull();
    expect(parseImportDate("2026-13-10")).toBeNull();
    expect(parseImportDate("31.02.2026")).toBeNull();
    expect(parseImportDate("not a date")).toBeNull();
  });
});
