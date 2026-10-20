export type ImportBatchIdentity = { id: string; contentHash: string; status: string };

export function findPreviouslyAppliedBatch(
  currentBatch: Pick<ImportBatchIdentity, "id" | "contentHash">,
  batches: ImportBatchIdentity[],
) {
  return batches.find((batch) => batch.id !== currentBatch.id && batch.contentHash === currentBatch.contentHash && batch.status === "applied");
}
