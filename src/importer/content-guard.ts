import { getImportRowFingerprint, type StableImportRow } from "./source-key";

export type ImportBatchIdentity = { id: string; contentHash: string; status: string };
export type NamedImportBatchIdentity = Omit<ImportBatchIdentity, "contentHash"> & { fileName: string; contentHash: string | null };
type ImportRowLocation = Pick<StableImportRow, "id" | "sheetName" | "rowNumber" | "rowType" | "data">;

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
  for (const row of appliedRows) {
    const key = `${row.sheetName}\u0000${row.rowNumber}\u0000${row.rowType}`;
    priorAtLocation.set(key, [...(priorAtLocation.get(key) ?? []), row]);
  }
  for (const row of currentRows) {
    const previousRows = priorAtLocation.get(`${row.sheetName}\u0000${row.rowNumber}\u0000${row.rowType}`) ?? [];
    const changed = previousRows.find((previous) => getImportRowFingerprint(previous) !== getImportRowFingerprint(row));
    if (changed) return changed;
  }
  return undefined;
}
