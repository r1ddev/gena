type OzonFinanceRow = Record<string, unknown>;

type BuyoutLine = { offerId: string; ozonSku: string | null };

export function matchBuyoutLines<T extends BuyoutLine>(lines: T[], reportProduct: { sku: string; offerId: string }): T[] {
  if (reportProduct.sku) return lines.filter((line) => line.ozonSku === reportProduct.sku);
  if (!reportProduct.offerId) return [];
  const matches = lines.filter((line) => line.offerId === reportProduct.offerId);
  return matches.length === 1 ? matches : [];
}

export function staleOzonAccrualKeys(day: string, existingKeys: string[], seenKeys: Set<string>, paginationComplete: boolean) {
  if (!paginationComplete) return [];
  const prefix = `${day}:`;
  return existingKeys.filter((key) => key.startsWith(prefix) && !seenKeys.has(key));
}

export function financeAccrualPostingNumber(category: string, unitNumber: string) {
  return ["POSTING", "ITEM"].includes(category.toUpperCase()) ? unitNumber || null : null;
}

export function postingContainsMarketplaceBuyout(raw: { products?: unknown }) {
  if (!Array.isArray(raw.products)) return false;
  return raw.products.some((product) =>
    Boolean(product && typeof product === "object" && "is_marketplace_buyout" in product && (product as { is_marketplace_buyout: unknown }).is_marketplace_buyout === true),
  );
}

export function financeRowContainsSku(raw: OzonFinanceRow, sku: string) {
  const itemFees = raw.item_fees;
  if (!itemFees || typeof itemFees !== "object") return false;
  const feeRows = (itemFees as { fees?: unknown }).fees;
  if (!Array.isArray(feeRows)) return false;
  return feeRows.some((row) =>
    Boolean(row && typeof row === "object" && "sku" in row && String((row as { sku: unknown }).sku) === sku),
  );
}

export function financeAccrualRowContainsSku(externalKey: string, raw: OzonFinanceRow, sku: string) {
  if (!sku) return false;
  const skuMarker = ":sku:";
  const markerIndex = externalKey.lastIndexOf(skuMarker);
  if (markerIndex < 0 || externalKey.slice(markerIndex + skuMarker.length) !== sku) return false;
  return financeRowContainsSku(raw, sku);
}
