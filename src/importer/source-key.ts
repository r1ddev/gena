import { createHash } from "node:crypto";

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

export function getImportRowFingerprint(row: Pick<StableImportRow, "rowType" | "data">) {
  return createHash("sha256")
    .update(JSON.stringify({ rowType: row.rowType, data: canonicalize(row.data) }))
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
    const sheet = row.sheetName.trim().toLocaleLowerCase("ru-RU");
    const base = `${sheet}:${row.rowType}:${getImportRowFingerprint(row)}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    result.set(row.id, `${base}:${occurrence}`);
  }

  return result;
}
