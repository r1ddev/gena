import { getImportRowFingerprint, type StableImportRow } from "./source-key";

export type ImportBatchIdentity = { id: string; contentHash: string; status: string };
export type NamedImportBatchIdentity = Omit<ImportBatchIdentity, "contentHash"> & { fileName: string; contentHash: string | null };
type ImportRowLocation = Pick<StableImportRow, "id" | "sheetName" | "rowNumber" | "rowType" | "data"> & { batchId?: string };

export function findPreviouslyAppliedBatch(
  currentBatch: Pick<ImportBatchIdentity, "id" | "contentHash">,
  batches: ImportBatchIdentity[],
) {
  return batches.find((batch) => batch.id !== currentBatch.id && batch.contentHash === currentBatch.contentHash && batch.status === "applied");
}

export function findChangedAppliedBatch(
  currentBatch: Pick<NamedImportBatchIdentity, "id" | "fileName" | "contentHash">,
  batches: NamedImportBatchIdentity[],
) {
  const fileName = currentBatch.fileName.trim().toLocaleLowerCase();
  return batches.find((batch) =>
    batch.id !== currentBatch.id &&
    batch.status === "applied" &&
    batch.fileName.trim().toLocaleLowerCase() === fileName &&
    batch.contentHash !== currentBatch.contentHash,
  );
}

export function findChangedAppliedRow(currentRows: ImportRowLocation[], appliedRows: ImportRowLocation[]) {
  const priorAtLocation = new Map<string, ImportRowLocation[]>();
  const currentFingerprints = new Map<string, number>();
  for (const row of appliedRows) {
    const key = `${row.sheetName}\u0000${row.rowNumber}\u0000${row.rowType}`;
    priorAtLocation.set(key, [...(priorAtLocation.get(key) ?? []), row]);
  }
  for (const row of currentRows) {
    const fingerprint = getImportRowFingerprint(row);
    currentFingerprints.set(fingerprint, (currentFingerprints.get(fingerprint) ?? 0) + 1);
  }
  for (const row of currentRows) {
    const previousRows = priorAtLocation.get(`${row.sheetName}\u0000${row.rowNumber}\u0000${row.rowType}`) ?? [];
    const changed = previousRows.find((previous) => {
      const previousFingerprint = getImportRowFingerprint(previous);
      const contentMovedElsewhere = (currentFingerprints.get(previousFingerprint) ?? 0) > 0;
      return previousFingerprint !== getImportRowFingerprint(row) && !contentMovedElsewhere;
    });
    if (changed) return changed;
  }

  const appliedBatches = new Map<string, ImportRowLocation[]>();
  for (const row of appliedRows) {
    const batchId = row.batchId ?? "applied-imports";
    appliedBatches.set(batchId, [...(appliedBatches.get(batchId) ?? []), row]);
  }
  for (const rows of appliedBatches.values()) {
    const overlaps = rows.some((row) => (currentFingerprints.get(getImportRowFingerprint(row)) ?? 0) > 0);
    if (!overlaps) continue;
    const remaining = new Map(currentFingerprints);
    for (const row of rows) {
      const fingerprint = getImportRowFingerprint(row);
      const count = remaining.get(fingerprint) ?? 0;
      if (count > 0) remaining.set(fingerprint, count - 1);
      else return row;
    }
  }
  return undefined;
}
