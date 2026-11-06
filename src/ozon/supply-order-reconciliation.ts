import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { productLinks, products, supplies, supplyLines } from "@/db/schema";
import { ozonPost } from "./client";

type OzonCredentials = { clientId: string; apiKey: string };
type ProgressReporter = (label: string, counts?: { current: number; total: number }) => Promise<void> | void;

type SupplyOrderListResponse = {
  order_ids?: (number | string)[];
  last_id?: string;
};

type OzonSupply = {
  supply_id?: number | string;
  bundle_id?: string;
};

type OzonSupplyOrder = {
  order_id?: number | string;
  order_number?: number | string;
  supplies?: OzonSupply[];
};

type SupplyOrderGetResponse = { orders?: OzonSupplyOrder[] };
type SupplyBundleResponse = {
  items?: { sku?: number | string | null }[];
  has_next?: boolean;
  last_id?: string;
};

const SUPPLY_ORDER_STATES = [
  "DATA_FILLING",
  "READY_TO_SUPPLY",
  "ACCEPTED_AT_SUPPLY_WAREHOUSE",
  "IN_TRANSIT",
  "ACCEPTANCE_AT_STORAGE_WAREHOUSE",
  "REPORTS_CONFIRMATION_AWAITING",
  "REPORT_REJECTED",
  "COMPLETED",
  "REJECTED_AT_SUPPLY_WAREHOUSE",
  "CANCELLED",
];

const SUPPLY_ORDER_PAGE_SIZE = 100;
const SUPPLY_ORDER_DETAIL_BATCH_SIZE = 50;
const MAX_SUPPLY_ORDER_PAGES = 100;
const MAX_BUNDLE_PAGES = 100;

type SupplyReference = { value: string; exact: boolean };

function supplyReference(note: string): SupplyReference | null {
  const explicitOzonId = note.match(/(?:номер\s+поставки\s+Ozon|Ozon\s+ID)\s*[:№#]?\s*(\d{12,16})/i)?.[1];
  if (explicitOzonId) return { value: explicitOzonId, exact: true };

  const postNumber = note.match(/номер\s+поста\s*[:№#]?\s*(\d{1,16})/i)?.[1];
  if (postNumber) return { value: postNumber, exact: false };

  const plainNumber = note.trim().match(/^(\d{1,16})$/)?.[1];
  if (!plainNumber) return null;
  return { value: plainNumber, exact: plainNumber.length >= 12 };
}

function referenceMatches(reference: SupplyReference, orderNumber: string, supplyId: string) {
  const identifiers = [orderNumber, supplyId].filter(Boolean);
  return reference.exact
    ? identifiers.some((identifier) => identifier === reference.value)
    : identifiers.some((identifier) => identifier.endsWith(reference.value));
}

export function matchesOzonSupplyToLocalRecord(input: {
  note: string;
  localSkus: readonly (number | string)[];
  orderNumber: number | string;
  supplyId: number | string;
  ozonSkus: readonly (number | string)[];
}) {
  const reference = supplyReference(input.note);
  if (!reference || !referenceMatches(reference, String(input.orderNumber), String(input.supplyId))) return false;

  const ozonSkus = new Set(input.ozonSkus.map(String));
  return input.localSkus.some((sku) => ozonSkus.has(String(sku)));
}

async function loadSupplyOrderDetails(credentials: OzonCredentials, progress: ProgressReporter) {
  const orders: OzonSupplyOrder[] = [];
  let lastId = "";
  const seenCursors = new Set<string>();

  for (let page = 1; page <= MAX_SUPPLY_ORDER_PAGES; page += 1) {
    await progress("Загрузка заявок на поставку Ozon");
    const response = await ozonPost<SupplyOrderListResponse>("/v3/supply-order/list", {
      filter: { states: SUPPLY_ORDER_STATES },
      limit: SUPPLY_ORDER_PAGE_SIZE,
      sort_by: "ORDER_CREATION",
      sort_dir: "DESC",
      ...(lastId ? { last_id: lastId } : {}),
    }, credentials);

    const orderIds = [...new Map((response.order_ids ?? []).map((orderId) => [String(orderId), orderId])).values()];
    if (!orderIds.length) return orders;

    let loaded = 0;
    for (let offset = 0; offset < orderIds.length; offset += SUPPLY_ORDER_DETAIL_BATCH_SIZE) {
      const batch = orderIds.slice(offset, offset + SUPPLY_ORDER_DETAIL_BATCH_SIZE);
      const details = await ozonPost<SupplyOrderGetResponse>("/v3/supply-order/get", { order_ids: batch }, credentials);
      orders.push(...(details.orders ?? []));
      loaded += batch.length;
      await progress("Получение ID поставок Ozon", { current: loaded, total: orderIds.length });
    }

    const nextLastId = response.last_id?.trim() ?? "";
    if (!nextLastId) return orders;
    if (nextLastId === lastId || seenCursors.has(nextLastId)) {
      throw new Error("Ozon повторил указатель страницы при загрузке поставок.");
    }
    seenCursors.add(nextLastId);
    lastId = nextLastId;
  }

  throw new Error("Список поставок Ozon превысил ограничение по числу страниц.");
}

async function loadBundleSkus(credentials: OzonCredentials, bundleId: string, progress: ProgressReporter, progressCounts: { current: number; total: number }) {
  const skus = new Set<string>();
  let lastId = "";

  for (let page = 0; page < MAX_BUNDLE_PAGES; page += 1) {
    const response = await ozonPost<SupplyBundleResponse>("/v1/supply-order/bundle", {
      bundle_ids: [bundleId],
      limit: 100,
      is_asc: true,
      ...(lastId ? { last_id: lastId } : {}),
    }, credentials);
    for (const item of response.items ?? []) {
      if (item.sku !== undefined && item.sku !== null && String(item.sku).trim()) skus.add(String(item.sku).trim());
    }
    if (!response.has_next) return skus;
    const nextLastId = response.last_id?.trim() ?? "";
    if (!nextLastId || nextLastId === lastId) throw new Error(`Не удалось дочитать состав поставки Ozon ${bundleId}.`);
    lastId = nextLastId;
    await progress("Загрузка состава поставок Ozon", progressCounts);
  }

  throw new Error(`Состав поставки Ozon ${bundleId} превысил ограничение по числу страниц.`);
}

export async function reconcileOzonSupplyIds(userId: string, credentials: OzonCredentials, progress: ProgressReporter = () => undefined) {
  const [headers, lineRows] = await Promise.all([
    db.select().from(supplies).where(eq(supplies.userId, userId)),
    db.select({ supplyId: supplyLines.supplyId, ozonSku: productLinks.ozonSku, archived: products.archived })
      .from(supplyLines)
      .innerJoin(products, and(eq(products.id, supplyLines.productId), eq(products.userId, userId)))
      .leftJoin(productLinks, and(eq(productLinks.productId, supplyLines.productId), eq(productLinks.userId, userId)))
      .where(eq(supplyLines.userId, userId)),
  ]);

  const skusBySupplyId = new Map<string, Set<string>>();
  for (const line of lineRows) {
    if (!line.ozonSku || line.archived) continue;
    const skus = skusBySupplyId.get(line.supplyId) ?? new Set<string>();
    skus.add(String(line.ozonSku));
    skusBySupplyId.set(line.supplyId, skus);
  }

  const targets = headers.flatMap((supply) => {
    const inferredOzon = supply.marketplace === "ozon" || (supply.marketplace === "unknown" && supply.sourceKey === null);
    const reference = supplyReference(supply.note);
    const localSkus = skusBySupplyId.get(supply.id);
    if (supply.ozonSupplyId || !inferredOzon || !reference || !localSkus?.size) return [];
    return [{ ...supply, reference, localSkus }];
  });
  if (!targets.length) return { listedOrders: 0, matchedSupplies: 0, ambiguousSupplies: 0, unmatchedSupplies: 0 };

  const orders = await loadSupplyOrderDetails(credentials, progress);
  const candidates = orders.flatMap((order) => (order.supplies ?? []).flatMap((supply) => {
    const orderNumber = String(order.order_number ?? "");
    const supplyId = String(supply.supply_id ?? "");
    if (!/^\d{12,16}$/.test(supplyId) || !supply.bundle_id) return [];
    if (!targets.some((target) => referenceMatches(target.reference, orderNumber, supplyId))) return [];
    return [{ orderNumber, supplyId, bundleId: supply.bundle_id }];
  }));
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.supplyId, candidate])).values()];
  const bundleIds = [...new Set(uniqueCandidates.map((candidate) => candidate.bundleId))];
  const bundleSkus = new Map<string, Set<string>>();
  for (const [index, bundleId] of bundleIds.entries()) {
    bundleSkus.set(bundleId, await loadBundleSkus(credentials, bundleId, progress, { current: index + 1, total: bundleIds.length }));
  }

  const candidateIdsByLocalSupply = new Map<string, Set<string>>();
  const localSupplyIdsByOzonId = new Map<string, Set<string>>();
  for (const candidate of uniqueCandidates) {
    const ozonSkus = bundleSkus.get(candidate.bundleId) ?? new Set<string>();
    for (const target of targets) {
      if (!referenceMatches(target.reference, candidate.orderNumber, candidate.supplyId)) continue;
      if (![...target.localSkus].some((sku) => ozonSkus.has(sku))) continue;
      const supplyIds = candidateIdsByLocalSupply.get(target.id) ?? new Set<string>();
      supplyIds.add(candidate.supplyId);
      candidateIdsByLocalSupply.set(target.id, supplyIds);
      const localIds = localSupplyIdsByOzonId.get(candidate.supplyId) ?? new Set<string>();
      localIds.add(target.id);
      localSupplyIdsByOzonId.set(candidate.supplyId, localIds);
    }
  }

  const usedOzonIds = new Set(headers.flatMap((supply) => supply.ozonSupplyId ? [supply.ozonSupplyId] : []));
  let matchedSupplies = 0;
  let ambiguousSupplies = 0;
  await db.transaction(async (tx) => {
    for (const target of targets) {
      const candidateIds = [...(candidateIdsByLocalSupply.get(target.id) ?? [])];
      if (candidateIds.length !== 1) {
        if (candidateIds.length > 1) ambiguousSupplies += 1;
        continue;
      }
      const supplyId = candidateIds[0];
      if (usedOzonIds.has(supplyId) || localSupplyIdsByOzonId.get(supplyId)?.size !== 1) {
        ambiguousSupplies += 1;
        continue;
      }
      const [updated] = await tx.update(supplies)
        .set({ marketplace: "ozon", ozonSupplyId: supplyId })
        .where(and(eq(supplies.userId, userId), eq(supplies.id, target.id), isNull(supplies.ozonSupplyId)))
        .returning({ id: supplies.id });
      if (updated) {
        usedOzonIds.add(supplyId);
        matchedSupplies += 1;
      }
    }
  });

  return {
    listedOrders: orders.length,
    matchedSupplies,
    ambiguousSupplies,
    unmatchedSupplies: targets.length - matchedSupplies - ambiguousSupplies,
  };
}
