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

export function groupFinanceItemFees(fees: unknown[]) {
  const totalsByType = new Map<string, number>();
  for (const candidate of fees) {
    if (!candidate || typeof candidate !== "object") continue;
    const fee = candidate as { type_id?: unknown; accrued?: unknown };
    const typeId = String(fee.type_id ?? "unknown");
    const amount = fee.accrued && typeof fee.accrued === "object" && "amount" in fee.accrued
      ? Number((fee.accrued as { amount?: unknown }).amount ?? 0)
      : Number(fee.accrued ?? 0);
    if (!Number.isFinite(amount)) continue;
    totalsByType.set(typeId, (totalsByType.get(typeId) ?? 0) + Math.round(amount * 100));
  }
  return [...totalsByType.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([typeId, cents]) => ({ typeId, amount: cents / 100 }));
}

const writeoffCompensationTypeIds = new Set(["10", "25"]);

export function isOzonWriteoffCompensation(input: { typeId?: string | null; raw?: OzonFinanceRow }) {
  const ids = new Set<string>();
  const addIdValues = (value: unknown) => {
    if (typeof value === "string" || typeof value === "number") {
      for (const id of String(value).split(/[ ,|]+/)) if (id) ids.add(id);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) addIdValues(item);
    }
  };
  const visitRaw = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visitRaw(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "type_id" || key === "accrual_id") addIdValues(child);
      else visitRaw(child);
    }
  };
  const explicitIds = (input.typeId ?? "").split(/[ ,|]+/).filter(Boolean);
  if (explicitIds.length) return explicitIds.every((id) => writeoffCompensationTypeIds.has(id));
  if (input.raw) visitRaw(input.raw);
  return ids.size === 1 && [...ids].every((id) => writeoffCompensationTypeIds.has(id));
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
  const suffixSku = markerIndex < 0 ? "" : externalKey.slice(markerIndex + skuMarker.length).split(":", 1)[0];
  if (suffixSku !== sku) return false;
  return financeRowContainsSku(raw, sku);
}
