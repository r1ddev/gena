import { financeAccrualRelatedOfferIds, financeAccrualRelatedSkus } from "./finance";

type CatalogProduct = { id: string; sku: string; archived?: boolean };
type ProductLink = { productId: string; offerId: string; ozonSku: string };
type ExternalProduct = {
  externalKey?: string | null;
  offerId?: string | null;
  ozonSku?: string | null;
  productId?: string | null;
};

export type CatalogProductWhitelist = {
  productIds: Set<string>;
  productIdByOfferId: Map<string, Set<string>>;
  productIdByOzonSku: Map<string, Set<string>>;
};

function addProductIdentifier(index: Map<string, Set<string>>, identifier: string, productId: string) {
  const normalized = identifier.trim();
  if (!normalized) return;
  const productIds = index.get(normalized) ?? new Set<string>();
  productIds.add(productId);
  index.set(normalized, productIds);
}

function externalKeyIdentifiers(externalKey: string | null | undefined) {
  if (!externalKey) return { offerId: "", ozonSku: "" };
  const offerId = externalKey.match(/(?:^|[|:])offer:([^:|]+)/)?.[1]?.trim() ?? "";
  const ozonSku = externalKey.match(/(?:^|[|:])sku:([^:|]+)/)?.[1]?.trim() ?? "";
  return { offerId: offerId === "?" ? "" : offerId, ozonSku: ozonSku === "?" ? "" : ozonSku };
}

export function buildCatalogProductWhitelist(
  products: CatalogProduct[],
  links: ProductLink[] = [],
  externalProducts: ExternalProduct[] = [],
): CatalogProductWhitelist {
  const activeProducts = products.filter((product) => !product.archived);
  const productIds = new Set(activeProducts.map((product) => product.id));
  const productIdByOfferId = new Map<string, Set<string>>();
  const productIdByOzonSku = new Map<string, Set<string>>();

  for (const product of activeProducts) addProductIdentifier(productIdByOfferId, product.sku, product.id);
  for (const link of links) {
    if (!productIds.has(link.productId)) continue;
    addProductIdentifier(productIdByOfferId, link.offerId, link.productId);
    addProductIdentifier(productIdByOzonSku, link.ozonSku, link.productId);
  }
  for (const item of externalProducts) {
    if (!item.productId || !productIds.has(item.productId)) continue;
    const fromKey = externalKeyIdentifiers(item.externalKey);
    addProductIdentifier(productIdByOfferId, item.offerId || fromKey.offerId, item.productId);
    addProductIdentifier(productIdByOzonSku, item.ozonSku || fromKey.ozonSku, item.productId);
  }

  return { productIds, productIdByOfferId, productIdByOzonSku };
}

function mappedProductIds(index: Map<string, Set<string>>, identifier: string) {
  return index.get(identifier.trim()) ?? new Set<string>();
}

export function resolveCatalogProductId(
  whitelist: CatalogProductWhitelist,
  item: { productId?: string | null; offerId?: string | null; ozonSku?: string | null; externalKey?: string | null },
) {
  if (item.productId && whitelist.productIds.has(item.productId)) return item.productId;
  const fromKey = externalKeyIdentifiers(item.externalKey);
  const offerId = item.offerId?.trim() || fromKey.offerId;
  const ozonSku = item.ozonSku?.trim() || fromKey.ozonSku;
  const matches = new Set([
    ...(offerId ? mappedProductIds(whitelist.productIdByOfferId, offerId) : []),
    ...(ozonSku ? mappedProductIds(whitelist.productIdByOzonSku, ozonSku) : []),
  ]);
  return matches.size === 1 ? [...matches][0] : null;
}

export function isCatalogProduct(
  whitelist: CatalogProductWhitelist,
  item: { productId?: string | null; offerId?: string | null; ozonSku?: string | null; externalKey?: string | null },
) {
  return resolveCatalogProductId(whitelist, item) !== null;
}

export function isFinanceRowOutsideCatalog(
  whitelist: CatalogProductWhitelist,
  row: { externalKey: string; raw: Record<string, unknown>; relatedSkus?: string[] | null; productId?: string | null },
  postingIdentifiers?: { skus: readonly string[]; offerIds: readonly string[] },
) {
  const directSkus = financeAccrualRelatedSkus(row);
  const directOfferIds = financeAccrualRelatedOfferIds(row);
  const skus = [...new Set([...directSkus, ...(postingIdentifiers?.skus ?? [])])];
  const offerIds = [...new Set([...directOfferIds, ...(postingIdentifiers?.offerIds ?? [])])];
  const hasIdentifiers = Boolean(row.productId) || skus.length > 0 || offerIds.length > 0;
  if (!hasIdentifiers) return false;

  const matches = new Set<string>();
  for (const sku of skus) for (const productId of mappedProductIds(whitelist.productIdByOzonSku, sku)) matches.add(productId);
  for (const offerId of offerIds) for (const productId of mappedProductIds(whitelist.productIdByOfferId, offerId)) matches.add(productId);
  if (row.productId && whitelist.productIds.has(row.productId)) matches.add(row.productId);

  return matches.size === 0;
}
