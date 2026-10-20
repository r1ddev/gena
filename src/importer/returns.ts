export function getLegacyReturnWriteMode(existingRaw: unknown): "insert" | "update" | "conflict" {
  if (!existingRaw) return "insert";
  if (typeof existingRaw !== "object" || Array.isArray(existingRaw)) return "conflict";
  return (existingRaw as Record<string, unknown>).source === "legacy-import" ? "update" : "conflict";
}

export type ReturnReconciliation = {
  postingNumber: string | null;
  destination: "seller" | "ozon" | "unknown";
  receivedBySellerAt: Date | null;
  availableAtOzon: Date | null;
};

type ExistingReturnReconciliation = Partial<ReturnReconciliation> & { manualReconciliationFields?: string[] };

export function mergeLegacyReturnReconciliation(
  existing: ExistingReturnReconciliation | null,
  incoming: ReturnReconciliation,
): ReturnReconciliation {
  const manuallySet = new Set(existing?.manualReconciliationFields ?? []);
  return {
    postingNumber: manuallySet.has("postingNumber") ? existing?.postingNumber ?? null : incoming.postingNumber ?? existing?.postingNumber ?? null,
    destination: manuallySet.has("destination") ? existing?.destination ?? "unknown" : incoming.destination === "unknown" ? existing?.destination ?? "unknown" : incoming.destination,
    receivedBySellerAt: manuallySet.has("receivedBySellerAt") ? existing?.receivedBySellerAt ?? null : incoming.receivedBySellerAt ?? existing?.receivedBySellerAt ?? null,
    availableAtOzon: manuallySet.has("availableAtOzon") ? existing?.availableAtOzon ?? null : incoming.availableAtOzon ?? existing?.availableAtOzon ?? null,
  };
}
