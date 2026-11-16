import { ozonPost } from "./client";

type OzonCredentials = { clientId: string; apiKey: string };
type SupplyBundleItem = { sku?: string | number | null };

type CargoesResponse = {
  supply?: {
    supply_id?: string | number;
    bundle_id?: string;
    cargoes?: { bundle_id?: string }[];
  }[];
};

type SupplyBundleResponse = {
  items?: SupplyBundleItem[];
  has_next?: boolean;
  last_id?: string;
};

const SUPPLY_ID_PATTERN = /^\d{12,16}$/;

export function isOzonSupplyUnitNumber(unitNumber: string) {
  return SUPPLY_ID_PATTERN.test(unitNumber);
}

export async function loadOzonSupplySkus(
  credentials: OzonCredentials,
  supplyIds: string[],
  onProgress?: (current: number, total: number) => Promise<void> | void,
) {
  const uniqueIds = [...new Set(supplyIds.filter(isOzonSupplyUnitNumber))];
  const result = new Map<string, string[]>();
  const supplyBundles = new Map<string, Set<string>>();
  const suppliesByBundle = new Map<string, Set<string>>();
  const failedIds = new Set<string>();

  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const batch = uniqueIds.slice(offset, offset + 100);
    try {
      const response = await ozonPost<CargoesResponse>("/v1/cargoes/get", { supply_ids: batch }, credentials);
      const foundIds = new Set<string>();
      for (const supply of response.supply ?? []) {
        const supplyId = String(supply.supply_id ?? "");
        if (!batch.includes(supplyId)) continue;
        foundIds.add(supplyId);
        result.set(supplyId, []);
        const bundleIds = new Set([
          ...(supply.bundle_id ? [supply.bundle_id] : []),
          ...(supply.cargoes ?? []).flatMap((cargo) => cargo.bundle_id ? [cargo.bundle_id] : []),
        ]);
        if (!bundleIds.size) continue;
        supplyBundles.set(supplyId, bundleIds);
        for (const bundleId of bundleIds) {
          suppliesByBundle.set(bundleId, new Set([...(suppliesByBundle.get(bundleId) ?? []), supplyId]));
        }
      }
      for (const supplyId of batch) if (!foundIds.has(supplyId)) failedIds.add(supplyId);
    } catch {
      for (const supplyId of batch) failedIds.add(supplyId);
    }
  }

  const skusByBundle = new Map<string, string[]>();
  const failedBundles = new Set<string>();
  const bundleIds = [...suppliesByBundle.keys()];
  let completed = 0;
  for (const bundleId of bundleIds) {
    const skus = new Set<string>();
    let lastId = "";
    let finished = false;
    try {
      for (let page = 0; page < 100; page += 1) {
        const response = await ozonPost<SupplyBundleResponse>("/v1/supply-order/bundle", {
          bundle_ids: [bundleId],
          limit: 100,
          is_asc: true,
          ...(lastId ? { last_id: lastId } : {}),
        }, credentials);
        for (const item of response.items ?? []) {
          if (item.sku !== undefined && item.sku !== null && String(item.sku).trim()) skus.add(String(item.sku).trim());
        }
        if (!response.has_next) {
          finished = true;
          break;
        }
        if (!response.last_id || response.last_id === lastId) break;
        lastId = response.last_id;
      }
      if (finished) skusByBundle.set(bundleId, [...skus].sort());
      else {
        failedBundles.add(bundleId);
      }
    } catch {
      failedBundles.add(bundleId);
    }
    completed += 1;
    await onProgress?.(completed, bundleIds.length);
  }

  for (const [supplyId, supplyBundleIds] of supplyBundles) {
    if ([...supplyBundleIds].some((bundleId) => failedBundles.has(bundleId))) {
      result.delete(supplyId);
      failedIds.add(supplyId);
      continue;
    }
    const skus = new Set([...supplyBundleIds].flatMap((bundleId) => skusByBundle.get(bundleId) ?? []));
    result.set(supplyId, [...skus].sort());
  }

  return { skusBySupplyId: result, failedIds };
}
