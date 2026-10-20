import { createHash } from "node:crypto";
import { normalizeImportHeader, parseImportDate, parseImportMoney } from "./workbook";
import { expenseImportFields } from "./expense-fields";

export function makeImportSourceKey(sourceNamespace: string, sourcePath: string) {
  const namespaceHash = createHash("sha256").update(sourceNamespace.trim().toLowerCase()).digest("hex").slice(0, 24);
  const pathHash = createHash("sha256").update(sourcePath).digest("hex").slice(0, 32);
  return `import:${namespaceHash}:${pathHash}`;
}

export type StableImportRow = { id: string; sheetName: string; rowNumber: number; rowType: string; data: unknown };

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

const headerAliases = new Map<string, string>();
for (const [canonical, aliases] of Object.entries({
  sku: ["sku", "артикул", "карточка", "карточка (артикул)", "код товара", "offer id", "seller sku"],
  quantity: ["количество", "кол-во", "qty", "quantity"],
  amount: ["сумма", "сумм", "стоимость закупки", "итого", "расход", "amount"],
  date: ["дата", "date"],
})) {
  for (const alias of aliases) headerAliases.set(normalizeImportHeader(alias), canonical);
}

function semanticValue(header: string, value: unknown): unknown {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const isIdentifier = /(^|__)(sku|артикул|карточка|кодтовара|offerid|sellersku)(__|$)/u.test(header);
  const isDate = /дата|date|time|время/u.test(header);
  if (isDate) {
    const parsed = parseImportDate(value);
    if (parsed) return `date:${parsed}`;
  }
  const isNumeric = !isIdentifier && /колич|колво|qty|quantity|сумм|стоим|цен|amount|price|cost|расход|доставк|остаток|факт|actual/u.test(header);
  if (isNumeric) {
    const parsed = parseImportMoney(value);
    if (parsed !== null) return `number:${String(parsed)}`;
  }
  if (value instanceof Date) return `date-time:${value.toISOString()}`;
  if (typeof value === "number") return isIdentifier ? `text:${String(value)}` : `number:${String(value)}`;
  if (typeof value === "boolean") return `boolean:${String(value)}`;
  if (typeof value === "string") return `text:${value.normalize("NFC").trim().replace(/\s+/gu, " ")}`;
  return canonicalize(value);
}

function semanticData(rowType: string, data: unknown): unknown {
  if (!data || typeof data !== "object" || !("cells" in data)) return canonicalize(data);
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return canonicalize(data);
  const entries = Object.entries(cells as Record<string, unknown>).flatMap(([rawHeader, value]) => {
    const duplicateSuffix = rawHeader.match(/__(\d+)$/u)?.[1];
    const normalized = normalizeImportHeader(rawHeader.replace(/__\d+$/u, ""));
    const canonicalHeader = rowType === "expenses" ? canonicalExpenseHeader(normalized, value) : headerAliases.get(normalized) ?? normalized;
    const header = `${canonicalHeader}${duplicateSuffix ? `__${duplicateSuffix}` : ""}`;
    const normalizedValue = semanticValue(header, value);
    return normalizedValue === null ? [] : [[header, normalizedValue] as const];
  });
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function canonicalExpenseHeader(normalizedHeader: string, value: unknown) {
  const matches = (aliases: string[]) => aliases.some((alias) => normalizeImportHeader(alias) === normalizedHeader);
  if (matches(expenseImportFields.spentAt)) return "date";
  if (matches(expenseImportFields.amount) && (normalizedHeader !== normalizeImportHeader("расход") || isNumericImportValue(value))) return "amount";
  if (matches(expenseImportFields.category)) return "category";
  if (matches(expenseImportFields.note)) return "note";
  return headerAliases.get(normalizedHeader) ?? normalizedHeader;
}

function isNumericImportValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const normalized = value.replace(/[\s\u00a0\u202f₽]/gu, "").trim();
  return /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(normalized) && parseImportMoney(value) !== null;
}

export function getImportRowFingerprint(row: Pick<StableImportRow, "rowType" | "data">) {
  return createHash("sha256")
    .update(JSON.stringify({ rowType: row.rowType, data: semanticData(row.rowType, row.data) }))
    .digest("hex")
    .slice(0, 32);
}

export function makeStableImportRowKeys(rows: StableImportRow[]) {
  const orderedRows = [...rows].sort((left, right) =>
    left.sheetName.localeCompare(right.sheetName) || left.rowNumber - right.rowNumber || left.id.localeCompare(right.id),
  );
  const occurrences = new Map<string, number>();
  const result = new Map<string, string>();

  for (const row of orderedRows) {
    const base = `${row.rowType}:${getImportRowFingerprint(row)}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    result.set(row.id, `${base}:${occurrence}`);
  }

  return result;
}
