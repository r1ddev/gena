import { financeAccrualRelatedOfferIds, financeAccrualRelatedSkus } from "./finance";

export type IgnoredOzonProductRow = {
  externalKey: string;
  offerId: string;
  ozonSku: string;
  disposition: string;
  productId?: string | null;
};

export type IgnoredOzonProductIndex = {
  externalKeys: Set<string>;
  offerIds: Set<string>;
  skus: Set<string>;
  productIds: Set<string>;
};

export function buildIgnoredOzonProductIndex(rows: IgnoredOzonProductRow[]): IgnoredOzonProductIndex {
  const ignoredRows = rows.filter((row) => row.disposition === "ignored");
  return {
    externalKeys: new Set(ignoredRows.map((row) => row.externalKey.trim()).filter(Boolean)),
    offerIds: new Set(ignoredRows.map((row) => row.offerId.trim()).filter(Boolean)),
    skus: new Set(ignoredRows.map((row) => row.ozonSku.trim()).filter(Boolean)),
    productIds: new Set(ignoredRows.flatMap((row) => row.productId ? [row.productId] : [])),
  };
}

export function ozonSkuFromExternalKey(externalKey: string) {
  return externalKey.match(/(?:^|[|:])sku:([^:|]+)/)?.[1]?.trim() ?? "";
}

export function isIgnoredOzonProduct(
  ignored: IgnoredOzonProductIndex,
  item: { externalKey?: string | null; offerId?: string | null; ozonSku?: string | null; productId?: string | null },
) {
  const externalKey = item.externalKey?.trim() ?? "";
  const offerId = item.offerId?.trim() ?? "";
  const ozonSku = item.ozonSku?.trim() || ozonSkuFromExternalKey(externalKey);
  return Boolean(
    (externalKey && ignored.externalKeys.has(externalKey)) ||
    (offerId && ignored.offerIds.has(offerId)) ||
    (ozonSku && ignored.skus.has(ozonSku)) ||
    (item.productId && ignored.productIds.has(item.productId)),
  );
}

export function isIgnoredOzonFinanceRow(
  ignored: IgnoredOzonProductIndex,
  row: { externalKey: string; raw: Record<string, unknown>; relatedSkus?: string[] | null },
) {
  if (isIgnoredOzonProduct(ignored, { externalKey: row.externalKey })) return true;
  return financeAccrualRelatedSkus(row).some((sku) => ignored.skus.has(sku))
    || financeAccrualRelatedOfferIds(row).some((offerId) => ignored.offerIds.has(offerId));
}

export function isOzonFinanceRowOutsideCurrentCatalog(
  row: { externalKey: string; raw: Record<string, unknown>; relatedSkus?: string[] | null },
  currentCatalogSkus: Set<string>,
  currentCatalogOfferIds?: Set<string>,
  postingIdentifiers?: { skus: readonly string[]; offerIds: readonly string[] },
) {
  const relatedSkus = financeAccrualRelatedSkus(row);
  const relatedOfferIds = financeAccrualRelatedOfferIds(row);
  const hasDirectIdentifiers = relatedSkus.length > 0 || relatedOfferIds.length > 0;
  const skus = hasDirectIdentifiers ? relatedSkus : postingIdentifiers?.skus ?? [];
  const offerIds = hasDirectIdentifiers ? relatedOfferIds : postingIdentifiers?.offerIds ?? [];
  return skus.some((sku) => !currentCatalogSkus.has(sku))
    || Boolean(currentCatalogOfferIds && offerIds.some((offerId) => !currentCatalogOfferIds.has(offerId)));
}

export function ignoredCatalogProductIds(
  products: { id: string; sku: string }[],
  ignored: IgnoredOzonProductIndex,
) {
  return new Set(products.flatMap((product) =>
    ignored.productIds.has(product.id) || ignored.offerIds.has(product.sku) ? [product.id] : [],
  ));
}

export function assertCatalogProductsNotIgnored(
  products: { id: string; sku: string }[],
  ignoredRows: IgnoredOzonProductRow[],
) {
  const ignored = buildIgnoredOzonProductIndex(ignoredRows);
  const ignoredIds = ignoredCatalogProductIds(products, ignored);
  if (products.some((product) => ignoredIds.has(product.id))) {
    throw new Error("Игнорируемый товар нельзя добавить в эту запись.");
  }
}
