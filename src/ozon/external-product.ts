export type ExternalProductDisposition = "pending" | "mapped" | "created" | "ignored";

export type ExternalProductRecord = {
  externalKey: string;
  disposition: ExternalProductDisposition;
  productId: string | null;
};

export type ExternalItemDispositionRecord = {
  id: string;
  externalKey: string;
  ozonSku: string;
  disposition: ExternalProductDisposition;
  productId?: string | null;
};

export type ExternalProductLinkRecord = {
  offerId: string;
  ozonSku: string | null;
  productId: string;
};

export type PreservedProductMapping = { externalKey: string; productId: string };

export function externalProductKey(offerId: string, sku: string) {
  return `offer:${offerId || "?"}|sku:${sku || "?"}`;
}

export function exactProductLinkForOffer<T extends ExternalProductLinkRecord>(links: T[], offerId: string, sku: string) {
  return links.find((link) => link.offerId === offerId && link.ozonSku === sku);
}

export function dispositionAfterProductLink(disposition: ExternalProductDisposition): ExternalProductDisposition {
  return disposition === "created" ? "created" : "mapped";
}

export function externalItemKeysToIgnore(items: ExternalItemDispositionRecord[], selectedId: string) {
  const selected = items.find((item) => item.id === selectedId);
  if (!selected) return [];
  const keys = new Set<string>([selected.externalKey]);
  if (selected.ozonSku) {
    for (const item of items) {
      if (item.ozonSku !== selected.ozonSku) continue;
      if (item.disposition === "pending" || item.disposition === "ignored") keys.add(item.externalKey);
    }
  }
  return [...keys];
}

export function externalItemIgnorePlan(
  items: ExternalItemDispositionRecord[],
  selectedId: string,
  linkedMappings: PreservedProductMapping[] = [],
) {
  const mappings = items
    .filter((item) => item.id !== selectedId && (item.disposition === "mapped" || item.disposition === "created") && item.productId)
    .map(({ externalKey, productId }) => ({ externalKey, productId: productId! }));
  const mappingIdsByKey = new Map<string, Set<string>>();
  for (const mapping of [...mappings, ...linkedMappings]) {
    const productIds = mappingIdsByKey.get(mapping.externalKey) ?? new Set<string>();
    productIds.add(mapping.productId);
    mappingIdsByKey.set(mapping.externalKey, productIds);
  }
  const mappingsToPreserve = [...mappingIdsByKey]
    .filter(([, productIds]) => productIds.size === 1)
    .map(([externalKey, productIds]) => ({ externalKey, productId: [...productIds][0] }));
  const productIds = new Set(mappingsToPreserve.map((item) => item.productId));
  return {
    keysToIgnore: externalItemKeysToIgnore(items, selectedId),
    mappingsToPreserve,
    financeProductId: productIds.size === 1 ? [...productIds][0] : null,
  };
}

export function chooseExternalProductRecord(exact: ExternalProductRecord | undefined, sameSku: ExternalProductRecord[]) {
  const ignoredSku = sameSku.find((item) => item.disposition === "ignored");
  if (exact && exact.disposition !== "pending") return exact;
  return ignoredSku ?? exact ?? sameSku[0];
}

export function resolveExternalProductLink(
  disposition: ExternalProductDisposition,
  storedProductId: string | null,
  linkedProductId: string | null,
) {
  if (disposition === "ignored") return { productId: null, ignored: true };
  if (linkedProductId) return { productId: linkedProductId, ignored: false };
  if (disposition === "mapped" || disposition === "created") {
    return { productId: storedProductId, ignored: false };
  }
  return { productId: null, ignored: false };
}
