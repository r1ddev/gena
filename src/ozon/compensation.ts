import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_SUBSET_STEPS = 30_000;

export type OzonCompensationReportLine = {
  reportMonth: string;
  reportNumber: string;
  rowNumber: number;
  compensationType: string;
  productName: string;
  offerId: string;
  ozonSku: string;
  barcode: string;
  quantity: number | null;
  postingReferences: string[];
  markingCode: string;
  commissionInvoices: string[];
  declaredUnitValue: number | null;
  declaredTotalValue: number | null;
  reducedAmount: number | null;
  amount: number;
};

export type OzonCompensationReport = {
  reportMonth: string;
  reportNumber: string;
  lines: OzonCompensationReportLine[];
};

type CompensationAccrual = {
  externalKey: string;
  accrualDate: string;
  typeId: string;
  amount: string | number;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function xmlAttribute(attributes: string, name: string) {
  return attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? "";
}

function readSharedStrings(xml: string) {
  return [...xml.matchAll(/<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g)].map(([, content]) =>
    [...content.matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g)]
      .map(([, text]) => decodeXml(text))
      .join(""),
  );
}

function columnName(cellReference: string) {
  return cellReference.match(/^([A-Z]+)/i)?.[1]?.toUpperCase() ?? "";
}

function readCellValue(attributes: string, content: string, sharedStrings: string[]) {
  const type = xmlAttribute(attributes, "t");
  if (type === "inlineStr") {
    return [...content.matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g)]
      .map(([, text]) => decodeXml(text))
      .join("");
  }
  const raw = content.match(/<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/)?.[1] ?? "";
  const value = decodeXml(raw);
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  return value;
}

function readWorksheet(xml: string, sharedStrings: string[]) {
  const rows = new Map<number, Map<string, string>>();
  for (const [, rowAttributes, rowContent = ""] of xml.matchAll(/<(?:[\w.-]+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row>)/g)) {
    const rowNumber = Number(xmlAttribute(rowAttributes, "r"));
    if (!Number.isInteger(rowNumber)) continue;
    const cells = new Map<string, string>();
    for (const [, cellAttributes, cellContent = ""] of rowContent.matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g)) {
      const reference = xmlAttribute(cellAttributes, "r");
      const column = columnName(reference);
      if (column) cells.set(column, readCellValue(cellAttributes, cellContent, sharedStrings));
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

async function readZipEntry(filePath: string, entry: string) {
  try {
    const result = await execFileAsync("unzip", ["-p", filePath, entry], {
      encoding: "utf8",
      maxBuffer: MAX_XML_BYTES,
      timeout: 15_000,
    });
    return result.stdout;
  } catch (error) {
    const details = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
    if (String(details.code) === "1" && !details.stdout) return "";
    throw new Error(`Не удалось прочитать файл отчёта Ozon (${entry}).`);
  }
}

function numberOrNull(value: string | undefined) {
  const normalized = value?.trim().replace(/\s/g, "").replace(",", ".") ?? "";
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function splitReferences(value: string) {
  return value
    .split(/[;,\r\n]+/)
    .map((part) => part.replace(/^\s*№\s*/, "").trim())
    .filter(Boolean);
}

function normalizeReferences(references: string[]) {
  return [...new Set(references.flatMap((reference) => splitReferences(reference)))];
}

export async function parseOzonCompensationXlsx(bytes: Uint8Array, reportMonth: string): Promise<OzonCompensationReport> {
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_REPORT_BYTES) throw new Error("Размер отчёта о компенсациях Ozon некорректен.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Ozon вернул файл не в формате XLSX.");

  const directory = await mkdtemp(join(tmpdir(), "ozon-compensation-"));
  const filePath = join(directory, "report.xlsx");
  try {
    await writeFile(filePath, bytes);
    const [sharedXml, worksheetXml] = await Promise.all([
      readZipEntry(filePath, "xl/sharedStrings.xml"),
      readZipEntry(filePath, "xl/worksheets/sheet1.xml"),
    ]);
    if (!worksheetXml) throw new Error("В отчёте о компенсациях Ozon нет листа с данными.");
    const sharedStrings = readSharedStrings(sharedXml);
    const worksheet = readWorksheet(worksheetXml, sharedStrings);
    const reportTitle = worksheet.get(2)?.get("B") ?? "";
    const reportNumber = reportTitle.match(/№\s*([\w-]+)/)?.[1] ?? "";
    const header = worksheet.get(11);
    if (!reportNumber || !header?.get("C")?.includes("компенсации") || !header.get("O")?.includes("Итого к начислению")) {
      throw new Error("Структура отчёта о компенсациях Ozon изменилась; записи не сохранены.");
    }
    const lines: OzonCompensationReportLine[] = [];

    for (const [rowNumber, cells] of worksheet) {
      if (rowNumber < 13) continue;
      const compensationType = cells.get("C")?.trim() ?? "";
      const amount = numberOrNull(cells.get("O"));
      if (!compensationType || amount === null) continue;
      lines.push({
        reportMonth,
        reportNumber,
        rowNumber,
        compensationType,
        productName: cells.get("D")?.trim() ?? "",
        offerId: cells.get("E")?.trim() ?? "",
        ozonSku: cells.get("F")?.trim() ?? "",
        barcode: cells.get("G")?.trim() ?? "",
        quantity: numberOrNull(cells.get("H")),
        postingReferences: splitReferences(cells.get("I") ?? ""),
        markingCode: cells.get("J")?.trim() ?? "",
        commissionInvoices: splitReferences(cells.get("K") ?? ""),
        declaredUnitValue: numberOrNull(cells.get("L")),
        declaredTotalValue: numberOrNull(cells.get("M")),
        reducedAmount: numberOrNull(cells.get("N")),
        amount,
      });
    }

    return { reportMonth, reportNumber, lines };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cents(value: string | number | null | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function uniqueSubset(lines: OzonCompensationReportLine[], targetCents: number) {
  const candidates = lines
    .map((line, index) => ({ index, amount: cents(line.amount) }))
    .filter((line): line is { index: number; amount: number } => line.amount !== null && line.amount > 0 && line.amount <= targetCents)
    .sort((left, right) => right.amount - left.amount);
  const solutions: number[][] = [];
  let steps = 0;

  const search = (start: number, remaining: number, selected: number[]) => {
    if (++steps > MAX_SUBSET_STEPS || solutions.length > 1) return;
    if (remaining === 0) {
      solutions.push([...selected]);
      return;
    }
    for (let index = start; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate.amount > remaining) continue;
      selected.push(candidate.index);
      search(index + 1, remaining - candidate.amount, selected);
      selected.pop();
      if (solutions.length > 1 || steps > MAX_SUBSET_STEPS) return;
    }
  };

  search(0, targetCents, []);
  return steps > MAX_SUBSET_STEPS ? [] : solutions.length === 1 ? solutions[0] : [];
}

function monthOf(date: string) {
  return date.slice(0, 7);
}

export function matchOzonCompensationReports(
  accruals: CompensationAccrual[],
  reports: Pick<OzonCompensationReport, "reportMonth" | "lines">[],
) {
  const matched = new Map<string, OzonCompensationReportLine[]>();
  const reportByMonth = new Map(reports.map((report) => [report.reportMonth, report.lines]));
  const months = new Set(accruals.filter((row) => ["10", "25"].includes(row.typeId)).map((row) => monthOf(row.accrualDate)));

  for (const month of months) {
    const reportLines = reportByMonth.get(month) ?? [];
    if (!reportLines.length) continue;
    const rows = accruals.filter((row) => ["10", "25"].includes(row.typeId) && monthOf(row.accrualDate) === month && (cents(row.amount) ?? 0) > 0);
    let availableLines = reportLines.map((line, index) => ({ line, index }));
    let availableRows = [...rows];

    while (availableRows.length && availableLines.length) {
      const candidates = availableRows.flatMap((row) => {
        const indices = uniqueSubset(availableLines.map((entry) => entry.line), cents(row.amount) ?? 0);
        if (!indices.length) return [];
        return [{ row, indices: indices.map((index) => availableLines[index].index) }];
      });
      const conflicts = new Set<string>();
      for (let left = 0; left < candidates.length; left += 1) {
        const leftIndices = new Set(candidates[left].indices);
        for (let right = left + 1; right < candidates.length; right += 1) {
          if (candidates[right].indices.some((index) => leftIndices.has(index))) {
            conflicts.add(candidates[left].row.externalKey);
            conflicts.add(candidates[right].row.externalKey);
          }
        }
      }
      const assignments = candidates.filter((candidate) => !conflicts.has(candidate.row.externalKey));
      if (!assignments.length) break;

      const usedIndices = new Set(assignments.flatMap((assignment) => assignment.indices));
      for (const assignment of assignments) {
        matched.set(assignment.row.externalKey, assignment.indices.map((index) => {
          const line = reportLines[index];
          return { ...line, postingReferences: normalizeReferences(line.postingReferences) };
        }));
      }
      availableRows = availableRows.filter((row) => !assignments.some((assignment) => assignment.row.externalKey === row.externalKey));
      availableLines = availableLines.filter((entry) => !usedIndices.has(entry.index));
    }
  }

  return matched;
}
