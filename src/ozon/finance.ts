type OzonFinanceRow = Record<string, unknown>;

type BuyoutLine = { offerId: string; ozonSku: string | null };

const ozonBuyoutEarliestDate = Date.parse("2025-01-01T00:00:00.000Z");
const ozonReturnLogisticsTypeIds = new Set(["45", "59"]);

export function supportedOzonBuyoutRange(from: Date, to: Date) {
  const rangeFrom = new Date(Math.max(from.getTime(), ozonBuyoutEarliestDate));
  if (!Number.isFinite(rangeFrom.getTime()) || !Number.isFinite(to.getTime()) || rangeFrom > to) return null;
  return { from: rangeFrom, to: new Date(to) };
}

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

export function isOzonReturnLogisticsAccrual(typeId: string) {
  return ozonReturnLogisticsTypeIds.has(typeId);
}

export function financeAccrualPostingNumber(category: string, unitNumber: string, typeId = "") {
  const normalizedCategory = category.toUpperCase();
  const isPostingNumber = /^\d+-\d+-\d+$/.test(unitNumber);
  if (["POSTING", "ITEM", "UNSPECIFIED"].includes(normalizedCategory)) return isPostingNumber ? unitNumber : null;
  if (normalizedCategory === "NON_ITEM" && isOzonReturnLogisticsAccrual(typeId) && isPostingNumber) return unitNumber;
  return null;
}

export function buildFinanceOrderSkuPostingMap(
  postingRows: { id: string; externalId: string; orderNumber: string }[],
  itemRows: { postingId: string; ozonSku: string }[],
) {
  const postingById = new Map(postingRows.map((posting) => [posting.id, posting]));
  const candidates = new Map<string, Set<string>>();
  for (const item of itemRows) {
    if (!item.ozonSku) continue;
    const posting = postingById.get(item.postingId);
    if (!posting?.orderNumber) continue;
    const key = `${posting.orderNumber}\u0000${item.ozonSku}`;
    const matches = candidates.get(key) ?? new Set<string>();
    matches.add(posting.externalId);
    candidates.set(key, matches);
  }
  return new Map([...candidates].flatMap(([key, matches]) => matches.size === 1 ? [[key, [...matches][0]] as const] : []));
}

export function resolveFinanceAccrualPostingNumber(
  row: { externalKey: string; postingNumber?: string | null; accruedCategory: string; typeId?: string; raw: OzonFinanceRow },
  postingByOrderSku: Map<string, string>,
) {
  const unitNumber = typeof row.raw.unit_number === "string" ? row.raw.unit_number : row.postingNumber ?? "";
  const postingNumber = financeAccrualPostingNumber(row.accruedCategory, unitNumber, row.typeId);
  if (postingNumber) return postingNumber;
  if (row.accruedCategory.toUpperCase() !== "ITEM") return null;

  const skuMarkerIndex = row.externalKey.lastIndexOf(":sku:");
  if (skuMarkerIndex < 0) return null;
  const sku = row.externalKey.slice(skuMarkerIndex + 5).split(":", 1)[0];
  return postingByOrderSku.get(`${unitNumber}\u0000${sku}`) ?? null;
}

export function financeReturnLogisticsCents(raw: OzonFinanceRow) {
  let totalCents = 0;
  const addReturnFee = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) addReturnFee(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (isOzonReturnLogisticsAccrual(String(record.type_id ?? ""))) {
      const amount = financeMoneyCents(record.accrued ?? record.amount);
      if (amount !== null) {
        totalCents += amount;
        return;
      }
    }
    for (const child of Object.values(record)) addReturnFee(child);
  };
  addReturnFee(raw);
  return totalCents;
}

export function financePostingSaleSkus(raw: OzonFinanceRow): string[] {
  const posting = raw.posting;
  if (!posting || typeof posting !== "object") return [];
  const products = (posting as { products?: unknown }).products;
  if (!Array.isArray(products)) return [];
  const totalAmount = financeMoneyCents(raw.total_amount);
  if (totalAmount === null || products.length === 0) return [];
  let reconstructedCents = 0;
  const skus: string[] = [];
  for (const candidate of products) {
    if (!candidate || typeof candidate !== "object") return [];
    const product = candidate as { sku?: unknown; commission?: unknown; delivery?: unknown };
    if (product.sku === undefined || product.sku === null || !product.commission || typeof product.commission !== "object") return [];
    const commission = product.commission as Record<string, unknown>;
    const saleCents = financeMoneyCents(commission.sale_amount);
    const commissionCents = financeMoneyCents(commission.commission);
    const delivery = product.delivery && typeof product.delivery === "object" ? product.delivery as Record<string, unknown> : {};
    const deliveryCents = delivery.total_accrued === undefined || delivery.total_accrued === null
      ? 0
      : financeMoneyCents(delivery.total_accrued);
    if (saleCents === null || commissionCents === null || deliveryCents === null) return [];
    reconstructedCents += saleCents + commissionCents + deliveryCents;
    skus.push(String(product.sku));
  }
  return reconstructedCents === totalAmount ? [...new Set(skus)] : [];
}

function financeMoneyCents(value: unknown): number | null {
  const amount = value && typeof value === "object" && "amount" in value
    ? (value as { amount?: unknown }).amount
    : value;
  if (amount === undefined || amount === null || !Number.isFinite(Number(amount))) return null;
  return Math.round(Number(amount) * 100);
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
  const nonItemFee = input.raw?.non_item_fee;
  if (nonItemFee && typeof nonItemFee === "object" && "type_id" in nonItemFee) {
    const typeId = (nonItemFee as { type_id?: unknown }).type_id;
    if (typeof typeId === "string" || typeof typeId === "number") {
      return writeoffCompensationTypeIds.has(String(typeId));
    }
  }
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

export function isOzonSharedExpense(input: {
  postingNumber?: string | null;
  category?: string | null;
  typeId?: string | null;
  raw?: OzonFinanceRow;
}) {
  if (input.postingNumber) return false;
  const category = (input.category ?? "").toUpperCase();
  if (category === "POSTING") return false;
  // Acquiring is tied to an order even when several postings prevent a unique mapping.
  if (category === "ITEM" && input.typeId === "1") return false;
  return !isOzonWriteoffCompensation({ typeId: input.typeId, raw: input.raw });
}

export function isOzonBuyerOrderAccrual(input: {
  postingNumber?: string | null;
  category?: string | null;
  typeId?: string | null;
}) {
  if (input.postingNumber) return true;
  const category = (input.category ?? "").toUpperCase();
  return category === "POSTING" || (category === "ITEM" && input.typeId === "1");
}

export function ozonExpenseLabel(typeId: string, raw: OzonFinanceRow = {}, category = "") {
  const nonItemFee = raw.non_item_fee;
  const rawLabels = [
    raw.accrual_name,
    raw.operation_type_name,
    raw.name,
    nonItemFee && typeof nonItemFee === "object" ? (nonItemFee as Record<string, unknown>).name : null,
    nonItemFee && typeof nonItemFee === "object" ? (nonItemFee as Record<string, unknown>).title : null,
  ];
  const explicitLabel = rawLabels.find((value) => typeof value === "string" && value.trim().length > 0);
  if (typeof explicitLabel === "string") return explicitLabel.trim();
  if (["10", "25"].includes(typeId)) return "Компенсация Ozon";

  const knownLabels: Record<string, string> = {
    "1": "Эквайринг",
    "3": "Продвижение бренда",
    "12": "Кросс-докинг",
    "41": "Продвижение: оплата за клик",
    "46": "Размещение",
    "54": "Продвижение",
    "71": "Обработка товара",
    "76": "Страхование остатков",
    "77": "Обработка поставки",
    "96": "Сбор отзывов",
  };
  if (knownLabels[typeId]) return knownLabels[typeId];

  const normalizedCategory = category.toUpperCase();
  if (normalizedCategory === "POSTING") {
    const posting = raw.posting;
    const products = posting && typeof posting === "object" ? (posting as { products?: unknown }).products : null;
    if (Array.isArray(products) && products.some((product) => Boolean(product && typeof product === "object" && "delivery" in product))) {
      return "Доставка по заказу";
    }
    return "Операция по заказу";
  }
  if (normalizedCategory === "ITEM") return "Операция по товару";
  if (normalizedCategory === "NON_ITEM") return "Другая операция Ozon";
  return "Операция Ozon";
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

export function financeAccrualRelatedSkus(input: {
  externalKey: string;
  raw: OzonFinanceRow;
  relatedSkus?: string[] | null;
}) {
  const storedSkus = [...new Set((input.relatedSkus ?? []).map((sku) => sku.trim()).filter(Boolean))];
  if (storedSkus.length) return storedSkus;
  const keySku = input.externalKey.match(/(?:^|:)sku:([^:]+)/)?.[1]?.trim();
  if (keySku) return [keySku];

  const skus = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[\s-]/g, "_");
      if (["sku", "ozon_sku", "product_sku"].includes(normalizedKey) && (typeof child === "string" || typeof child === "number")) {
        const sku = String(child).trim();
        if (sku) skus.add(sku);
      } else {
        visit(child);
      }
    }
  };
  visit(input.raw);
  return [...skus];
}

export function financeAccrualRelatedOfferIds(input: { raw: OzonFinanceRow }) {
  const offerIds = new Set<string>();
  const offerKeys = new Set(["offer_id", "offerid", "seller_sku", "sellersku", "article"]);
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[\s-]/g, "_");
      if (offerKeys.has(normalizedKey) && (typeof child === "string" || typeof child === "number")) {
        const offerId = String(child).trim();
        if (offerId) offerIds.add(offerId);
      } else {
        visit(child);
      }
    }
  };
  visit(input.raw);
  return [...offerIds];
}

export function buildFinancePostingProductIdentifiers(
  postingRows: { id: string; externalId: string }[],
  itemRows: { postingId: string; externalKey?: string | null; offerId?: string | null; ozonSku?: string | null }[],
) {
  const postingById = new Map(postingRows.map((posting) => [posting.id, posting.externalId]));
  const identifiers = new Map<string, { skus: Set<string>; offerIds: Set<string> }>();
  for (const item of itemRows) {
    const postingNumber = postingById.get(item.postingId);
    if (!postingNumber) continue;
    const entry = identifiers.get(postingNumber) ?? { skus: new Set<string>(), offerIds: new Set<string>() };
    const sku = item.ozonSku?.trim() || item.externalKey?.match(/(?:^|[|:])sku:([^:|]+)/)?.[1]?.trim() || "";
    const offerId = item.offerId?.trim() || item.externalKey?.match(/(?:^|[|:])offer:([^:|]+)/)?.[1]?.trim() || "";
    if (sku && sku !== "?") entry.skus.add(sku);
    if (offerId && offerId !== "?") entry.offerIds.add(offerId);
    identifiers.set(postingNumber, entry);
  }
  return new Map([...identifiers].map(([postingNumber, ids]) => [postingNumber, {
    skus: [...ids.skus],
    offerIds: [...ids.offerIds],
  }] as const));
}

export function financeAccrualRowContainsSku(externalKey: string, raw: OzonFinanceRow, sku: string) {
  if (!sku) return false;
  const skuMarker = ":sku:";
  const markerIndex = externalKey.lastIndexOf(skuMarker);
  const suffixSku = markerIndex < 0 ? "" : externalKey.slice(markerIndex + skuMarker.length).split(":", 1)[0];
  if (suffixSku !== sku) return false;
  return financeRowContainsSku(raw, sku);
}
