import ExcelJS from "exceljs";

export type ImportRowType = "products" | "purchases" | "supplies" | "expenses" | "sales" | "returns" | "writeoffs" | "stocktakes" | "unknown";
export type WorkbookImportRow = {
  sheetName: string;
  rowNumber: number;
  type: ImportRowType;
  data: { headers: string[]; cells: Record<string, unknown>; values: unknown[] };
};

export const normalizeImportHeader = (value: string) => value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, "").trim();

export function getImportCellValue(cells: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(cells);
  for (const alias of aliases) {
    const key = normalizeImportHeader(alias);
    const found = entries.find(([name]) => name === key || name.startsWith(`${key}__`));
    if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim() !== "") return found[1];
  }
  return null;
}

export function getSupplyShippingCost(data: { headers: string[]; cells: Record<string, unknown>; values?: unknown[] }) {
  const aliases = ["стоимость доставки", "стоимость расходов", "стоим расходов", "доставка", "shipping cost"];
  const normalizedHeaders = data.headers.map(normalizeImportHeader);
  const unambiguousCostHeaders = aliases.map(normalizeImportHeader);
  const hasUnambiguousCostHeader = normalizedHeaders.some((header) => unambiguousCostHeaders.includes(header));
  if (hasUnambiguousCostHeader) return parseImportMoney(getImportCellValue(data.cells, aliases)) ?? 0;

  const legacyDescriptionHeader = normalizedHeaders[2];
  const legacyAmountHeader = normalizedHeaders[3];
  const isKnownLegacyLayout = ["расходы", "типрасхода"].includes(legacyDescriptionHeader ?? "")
    && ["сумма", "стоимость", "суммарасходов", "стоимостьрасходов"].includes(legacyAmountHeader ?? "");
  return isKnownLegacyLayout ? parseImportMoney(data.values?.[3]) ?? 0 : 0;
}

function cellValue(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) return cellValue(record.result);
    if (Array.isArray(record.richText)) return record.richText.map((part) => String((part as Record<string, unknown>).text ?? "")).join("");
    if (typeof record.text === "string") return record.text;
  }
  return null;
}

function isPopulated(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function classifyImportSheet(sheetName: string, headers: string[]): ImportRowType {
  const name = normalizeImportHeader(sheetName);
  const keys = headers.map(normalizeImportHeader);
  const has = (...parts: string[]) => keys.some((key) => parts.some((part) => key.includes(normalizeImportHeader(part))));
  if (/(закуп|покуп|purchase)/i.test(name)) return "purchases";
  if (/(постав|shipment|supply)/i.test(name)) return "supplies";
  if (/(расход|expense)/i.test(name)) return "expenses";
  if (/(продаж|заказ|sale|order)/i.test(name)) return "sales";
  if (/(возврат|return)/i.test(name)) return "returns";
  if (/(инвентар|stocktake|inventory)/i.test(name)) return "stocktakes";
  if (/(списан|writeoff)/i.test(name)) return "writeoffs";
  if (has("сумма", "amount") && has("категория", "расход", "expense")) return "expenses";
  if (has("статус", "status") && has("сумма", "amount") && has("id", "отправление", "заказ", "артикул", "sku")) return "sales";
  if (has("фактический остаток", "фактически", "actual quantity", "пересчет", "инвентаризация")) return "stocktakes";
  if (has("причина списания", "списано количество", "writeoff quantity")) return "writeoffs";
  if (has("дата возврата", "return date")) return "returns";
  if (has("дата поставки", "номер поставки", "supply id") && has("количество", "quantity")) return "supplies";
  if (has("дата закупки", "purchase date") || (has("получен", "received") && has("цена за", "unit cost") && has("количество", "quantity"))) return "purchases";
  if (has("sku", "артикул", "карточка") && (has("наименование", "название", "цвет", "размер", "product name"))) return "products";
  return "unknown";
}

function uniqueHeaders(rawHeaders: unknown[]): { headers: string[]; keys: string[] } {
  const headers: string[] = [];
  const keys: string[] = [];
  const counts = new Map<string, number>();
  for (let index = 0; index < rawHeaders.length; index += 1) {
    const raw = cellValue(rawHeaders[index]);
    const header = isPopulated(raw) ? String(raw).trim() : `Колонка ${index + 1}`;
    const base = normalizeImportHeader(header) || `колонка${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    headers.push(header);
    keys.push(count === 1 ? base : `${base}__${count}`);
  }
  return { headers, keys };
}

function toRows(sheetName: string, rawRows: unknown[][]): WorkbookImportRow[] {
  const headerIndex = rawRows.findIndex((row) => row.filter(isPopulated).length >= 2);
  if (headerIndex < 0) return [];
  const { headers, keys } = uniqueHeaders(rawRows[headerIndex]);
  const type = classifyImportSheet(sheetName, headers);
  return rawRows.slice(headerIndex + 1).flatMap((row, index) => {
    if (!row.some(isPopulated)) return [];
    const values = row.map(cellValue);
    const cells = Object.fromEntries(keys.map((key, column) => [key, values[column] ?? null]));
    return [{ sheetName, rowNumber: headerIndex + index + 2, type, data: { headers, cells, values } }];
  });
}

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  row.push(cell);
  if (row.some(isPopulated)) rows.push(row);
  return rows;
}

export async function parseImportBuffer(buffer: Buffer, fileName: string) {
  const extension = fileName.toLocaleLowerCase("en-US").split(".").pop();
  let sheets: { name: string; rows: unknown[][] }[];
  if (extension === "csv") {
    sheets = [{ name: fileName.replace(/\.csv$/i, "") || "CSV", rows: parseCsv(buffer.toString("utf8")) }];
  } else if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    await workbook.xlsx.load(bytes.buffer);
    sheets = workbook.worksheets.map((sheet) => {
      const rows: unknown[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: unknown[] = [];
        for (let column = 1; column <= row.cellCount; column += 1) values.push(row.getCell(column).value);
        rows.push(values);
      });
      return { name: sheet.name, rows };
    });
  } else {
    throw new Error("Поддерживаются файлы .xlsx и .csv.");
  }
  const rows = sheets.flatMap((sheet) => toRows(sheet.name, sheet.rows));
  if (!rows.length) throw new Error("В файле не найдены строки для проверки.");
  return { sheets: sheets.map(({ name }) => name), rows };
}

export function parseImportMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let normalized = value.replace(/[\s\u00a0\u202f₽]/g, "").replace(/[^\d,.-]/g, "");
  if (!normalized) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma > dot) normalized = normalized.replaceAll(".", "").replace(",", ".");
  else normalized = normalized.replaceAll(",", "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function dateFromParts(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseImportDate(value: unknown, fallback?: string): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20_000 && value < 100_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const input = value.trim();
    if (!input) return fallback ?? null;
    const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return dateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? fallback ?? null;
    const localized = input.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (localized) {
      const year = localized[3].length === 2 ? `20${localized[3]}` : localized[3];
      return dateFromParts(Number(year), Number(localized[2]), Number(localized[1])) ?? fallback ?? null;
    }
    const date = new Date(input);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return fallback ?? null;
}
