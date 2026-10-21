export function observeBuyerHandoffAt(existing: Date | null, status: string, observedAt: Date): Date | null {
  if (existing) return new Date(existing.getTime());
  return status.trim().toLowerCase() === "delivered" ? new Date(observedAt.getTime()) : null;
}

export function preserveMarketplaceBuyoutEvidence(
  importedBuyout: boolean,
  existing: { marketplaceBuyoutAt: Date | null } | null,
) {
  const marketplaceBuyoutAt = existing?.marketplaceBuyoutAt ?? null;
  return {
    isMarketplaceBuyout: importedBuyout || Boolean(marketplaceBuyoutAt),
    marketplaceBuyoutAt,
  };
}
