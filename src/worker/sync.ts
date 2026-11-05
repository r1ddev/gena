import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { getAccountingSnapshot, persistAddedCostRateSnapshots } from "@/domain/accounting-repository";
import {
  appSettings,
  externalItems,
  financeAccruals,
  ozonPayouts,
  ozonCompensationReports,
  ozonWriteoffs,
  postingItems,
  postings,
  productLinks,
  products,
  returns,
  syncJobs,
} from "@/db/schema";
import { decryptSecret } from "@/security/secrets";
import { ozonPost } from "@/ozon/client";
import { financeAccrualPostingNumber, financeAccrualRelatedSkus, groupFinanceItemFees, matchBuyoutLines, staleOzonAccrualKeys, supportedOzonBuyoutRange } from "@/ozon/finance";
import { isOzonSupplyUnitNumber, loadOzonSupplySkus } from "@/ozon/supply-attribution";
import { observeBuyerHandoffAt } from "@/ozon/postings";
import { chooseReturnPostingNumber } from "@/ozon/returns";
import { resolveOzonReturnTimeline } from "@/ozon/return-status";
import { parseOzonCompensationXlsx } from "@/ozon/compensation";
import { resolveOzonSyncRange, splitUtcDateRange } from "@/ozon/sync-range";
import { reconcileOzonSupplyIds } from "@/ozon/supply-order-reconciliation";
import { reconcileOzonSupplyLabels } from "@/ozon/supply-label-reconciliation";
import { chooseExternalProductRecord, dispositionAfterProductLink, exactProductLinkForOffer, externalProductKey, resolveExternalProductLink } from "@/ozon/external-product";
import { reconcileOzonSupplyCosts } from "@/ozon/supply-cost-reconciliation";

type JsonRecord = Record<string, unknown>;
type ProgressCounts = { current: number; total: number };
type ProgressReporter = (label: string, counts?: ProgressCounts) => Promise<void>;
type ExternalProduct = { offer_id?: unknown; sku?: unknown; name?: unknown; quantity?: unknown; price?: unknown; is_marketplace_buyout?: unknown };
type FboPosting = { posting_number?: unknown; order_number?: unknown; status?: unknown; created_at?: unknown; products?: ExternalProduct[]; [key: string]: unknown };
type OzonCredentials = { clientId: string; apiKey: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asString = (value: unknown, fallback = "") => value === undefined || value === null ? fallback : String(value);
const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const asRecord = (value: unknown): JsonRecord | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
const moneyAmount = (value: unknown) => asNumber(typeof value === "object" && value !== null && "amount" in value ? (value as { amount?: unknown }).amount : value);
const marketplaceBuyoutAmount = (product: JsonRecord) => {
  if (product.amount === undefined || product.amount === null || !Number.isFinite(Number(product.amount))) return null;
  return Number(product.amount).toFixed(2);
};
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, amount: number) => new Date(date.getTime() + amount * 24 * 60 * 60 * 1000);
const MAX_HISTORY_RANGE_DAYS = 365;

function externalKey(offerId: string, sku: string) {
  return externalProductKey(offerId, sku);
}

async function resolveExternalProduct(product: ExternalProduct, raw: JsonRecord) {
  const offerId = asString(product.offer_id);
  const sku = asString(product.sku);
  const key = externalKey(offerId, sku);
  const [exactRows, skuRows, links, skuLinks] = await Promise.all([
    offerId ? db.select().from(externalItems).where(eq(externalItems.externalKey, key)).limit(1) : Promise.resolve([]),
    sku ? db.select().from(externalItems).where(eq(externalItems.ozonSku, sku)) : Promise.resolve([]),
    offerId ? db.select().from(productLinks).where(eq(productLinks.offerId, offerId)) : Promise.resolve([]),
    sku ? db.select().from(productLinks).where(eq(productLinks.ozonSku, sku)) : Promise.resolve([]),
  ]);
  const exact = exactRows[0] ?? skuRows.find((item) => item.externalKey === key);
  const exactLink = exactProductLinkForOffer(links, offerId, sku);
  // A deliberate ignore follows Ozon's SKU across offer-id changes; a later explicit mapping for this exact key overrides it.
  const previous = chooseExternalProductRecord(exact, skuRows);
  if (previous?.disposition === "ignored" && !exactLink) {
    await db.insert(externalItems).values({
      externalKey: key,
      offerId,
      ozonSku: sku,
      title: asString(product.name, "Без названия"),
      disposition: "ignored",
      productId: null,
      raw,
      lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: externalItems.externalKey,
      set: { title: asString(product.name, "Без названия"), disposition: "ignored", productId: null, raw, lastSeenAt: new Date() },
    });
    return { externalKey: key, offerId, sku, ...resolveExternalProductLink("ignored", null, null) };
  }

  // Product deletion nulls the FK. A mapped/created record without a product is unresolved again.
  const previousDisposition = (previous?.disposition === "mapped" || previous?.disposition === "created") && !previous.productId
    ? "pending"
    : previous?.disposition ?? "pending";

  const link = exactLink
    ?? skuLinks.find((candidate) => candidate.ozonSku === sku)
    ?? (!sku ? links[0] : undefined);
  const resolutionDisposition = exactLink
    ? dispositionAfterProductLink(previousDisposition)
    : previousDisposition;
  const resolution = resolveExternalProductLink(resolutionDisposition, previous?.productId ?? null, link?.productId ?? null);
  if (link) {
    const disposition = dispositionAfterProductLink(previousDisposition);
    await db.insert(externalItems).values({
      externalKey: key,
      offerId,
      ozonSku: sku,
      title: asString(product.name, "Без названия"),
      disposition,
      productId: resolution.productId,
      raw,
      lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: externalItems.externalKey,
      set: { title: asString(product.name, "Без названия"), disposition, productId: resolution.productId, raw, lastSeenAt: new Date() },
    });
    return { externalKey: key, offerId, sku, ...resolution };
  }

  const disposition = previousDisposition;
  await db.insert(externalItems).values({
    externalKey: key,
    offerId,
    ozonSku: sku,
    title: asString(product.name, "Без названия"),
    disposition,
    productId: resolution.productId,
    raw,
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: externalItems.externalKey,
    set: { title: asString(product.name, "Без названия"), disposition, productId: resolution.productId, raw, lastSeenAt: new Date() },
  });
  return { externalKey: key, offerId, sku, ...resolution };
}

async function upsertFboPosting(posting: FboPosting) {
  const postingNumber = asString(posting.posting_number);
  if (!postingNumber) return false;
  const status = asString(posting.status, "unknown");
  const mappedProducts = await Promise.all((posting.products ?? []).map(async (product) => ({
    product,
    mapped: await resolveExternalProduct(product, product as JsonRecord),
  })));
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(postings).where(eq(postings.externalId, postingNumber)).limit(1);
    const oldItems = existing ? await tx.select().from(postingItems).where(eq(postingItems.postingId, existing.id)) : [];
    const oldItemByKey = new Map(oldItems.map((item) => [item.externalKey, item]));
    const allItemsAreMarketplaceBuyouts = mappedProducts.length > 0 && mappedProducts.every(({ product, mapped }) =>
      product.is_marketplace_buyout === true || oldItemByKey.get(mapped.externalKey)?.isMarketplaceBuyout === true,
    );
    const deliveredAt = allItemsAreMarketplaceBuyouts
      ? existing?.deliveredAt ?? null
      : observeBuyerHandoffAt(existing?.deliveredAt ?? null, status, new Date());
    const [saved] = await tx.insert(postings).values({
      externalId: postingNumber,
      orderNumber: asString(posting.order_number),
      status,
      orderDate: typeof posting.created_at === "string" ? new Date(posting.created_at) : null,
      deliveredAt,
      isMarketplaceBuyout: allItemsAreMarketplaceBuyouts,
      marketplaceBuyoutAt: existing?.marketplaceBuyoutAt ?? null,
      raw: posting as JsonRecord,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: postings.externalId,
      set: {
        orderNumber: asString(posting.order_number),
        status,
        deliveredAt,
        isMarketplaceBuyout: allItemsAreMarketplaceBuyouts,
        marketplaceBuyoutAt: existing?.marketplaceBuyoutAt ?? null,
        raw: posting as JsonRecord,
        updatedAt: new Date(),
      },
    }).returning({ id: postings.id });
    if (!saved) throw new Error(`Не удалось обновить отправление ${postingNumber}.`);
    await tx.delete(postingItems).where(eq(postingItems.postingId, saved.id));
    if (mappedProducts.length) await tx.insert(postingItems).values(mappedProducts.map(({ product, mapped }) => {
      const previous = oldItemByKey.get(mapped.externalKey);
      const isMarketplaceBuyout = product.is_marketplace_buyout === true || previous?.isMarketplaceBuyout === true;
      return {
        postingId: saved.id,
        externalKey: mapped.externalKey,
        productId: mapped.productId,
        offerId: mapped.offerId,
        ozonSku: mapped.sku,
        title: asString(product.name, "Без названия"),
        quantity: String(Math.max(0, asNumber(product.quantity))),
        price: String(Math.max(0, moneyAmount(product.price))),
        isMarketplaceBuyout,
        marketplaceBuyoutAt: previous?.marketplaceBuyoutAt ?? (existing?.isMarketplaceBuyout ? existing.marketplaceBuyoutAt : null),
        marketplaceBuyoutAmount: previous?.marketplaceBuyoutAmount ?? null,
        raw: product as JsonRecord,
      };
    }));
  });
  return true;
}

async function importPostings(credentials: OzonCredentials, from: Date, to: Date, progress: ProgressReporter) {
  const fetched = new Map<string, FboPosting>();
  let pages = 0;
  const ranges = splitUtcDateRange(from, to, MAX_HISTORY_RANGE_DAYS);
  for (const range of ranges) {
    let cursor = "";
    do {
      const response = await ozonPost<{ postings?: FboPosting[]; cursor?: string; has_next?: boolean; result?: { postings?: FboPosting[]; cursor?: string; has_next?: boolean } }>(
        "/v3/posting/fbo/list",
        {
          cursor: cursor || undefined,
          filter: { since: range.from.toISOString(), to: range.to.toISOString() },
          limit: 100,
          sort_dir: "ASC",
          with: { financial_data: true, analytics_data: false, legal_info: false },
        },
        credentials,
      );
      const page = response.postings ?? response.result?.postings ?? [];
      for (const posting of page) {
        const postingNumber = asString(posting.posting_number);
        if (postingNumber) fetched.set(postingNumber, posting);
      }
      pages += 1;
      await progress(`Загружено отправлений: ${fetched.size}`);
      cursor = response.cursor ?? response.result?.cursor ?? "";
      if (!(response.has_next ?? response.result?.has_next) || !cursor || pages >= 10_000) break;
      await sleep(250);
    } while (true);
    if (pages >= 10_000) break;
  }
  const postingsToSave = [...fetched.values()];
  let processed = 0;
  await progress("Сохранение отправлений", { current: 0, total: postingsToSave.length });
  for (const posting of postingsToSave) {
    if (await upsertFboPosting(posting)) processed += 1;
    if (processed % 10 === 0 || processed === postingsToSave.length) {
      await progress("Сохранение отправлений", { current: processed, total: postingsToSave.length });
    }
  }
  return processed;
}

type OzonReturn = {
  id?: unknown;
  posting_number?: unknown;
  product?: ExternalProduct;
  visual?: { status?: { sys_name?: unknown; display_name?: unknown }; change_moment?: unknown };
  logistic?: { return_date?: unknown; final_moment?: unknown };
  storage?: { arrived_moment?: unknown };
  target_place?: { name?: unknown; address?: unknown };
  schema?: unknown;
  [key: string]: unknown;
};

function guessReturnDestination(item: OzonReturn): "seller" | "ozon" | "unknown" {
  const place = `${asString(item.target_place?.name)} ${asString(item.target_place?.address)}`.toLowerCase();
  const status = asString(item.visual?.status?.sys_name).toLowerCase();
  if (["receivedbyseller", "movingtoseller", "returningtosellerbycourier"].includes(status)) return "seller";
  if (["movingtoozon", "returnedtoozon"].includes(status)) return "ozon";
  if (/ozon|озон|фулфилмент|склад/.test(place)) return "ozon";
  if (/пункт выдачи|пвз|возврат продавцу|seller/.test(place)) return "seller";
  return "unknown";
}

async function importReturns(credentials: OzonCredentials, from: Date, to: Date, progress: ProgressReporter) {
  const fetched = new Map<string, OzonReturn>();
  let pages = 0;
  const ranges = splitUtcDateRange(from, to, MAX_HISTORY_RANGE_DAYS);
  for (const range of ranges) {
    let lastId = 0;
    while (pages < 10_000) {
      const response = await ozonPost<{ returns?: OzonReturn[]; has_next?: boolean }>(
        "/v1/returns/list",
        {
          filter: { visual_status_change_moment: { time_from: range.from.toISOString(), time_to: range.to.toISOString() } },
          limit: 500,
          ...(lastId ? { last_id: lastId } : {}),
        },
        credentials,
      );
      const page = response.returns ?? [];
      if (page.length === 0) break;
      for (const item of page) {
        const id = asString(item.id);
        if (id) fetched.set(id, item);
      }
      pages += 1;
      await progress(`Загружено возвратов: ${fetched.size}`);
      lastId = Math.max(lastId, ...page.map((item) => asNumber(item.id)));
      if (!response.has_next || page.length < 500) break;
      await sleep(250);
    }
    if (pages >= 10_000) break;
  }

  const returnsToSave = [...fetched.values()];
  let total = 0;
  await progress("Сохранение возвратов", { current: 0, total: returnsToSave.length });
  for (let offset = 0; offset < returnsToSave.length; offset += 500) {
      const page = returnsToSave.slice(offset, offset + 500);
      const prepared = await Promise.all(page.map(async (item) => {
        const id = asString(item.id);
        const product = item.product ?? {};
        return { item, id, product, mapped: await resolveExternalProduct(product, item as JsonRecord), destination: guessReturnDestination(item) };
      }));
      const ids = prepared.map((entry) => entry.id);
      const existingRows = ids.length ? await db.select().from(returns).where(inArray(returns.externalId, ids)) : [];
      const oldById = new Map(existingRows.map((entry) => [entry.externalId, entry]));
      const candidateNumbers = [...new Set(prepared.flatMap((entry) => [
        asString(entry.item.posting_number), oldById.get(entry.id)?.postingNumber ?? "",
      ]).filter(Boolean))];
      const candidatePostingItems = candidateNumbers.length
        ? await db.select({ postingNumber: postings.externalId, productId: postingItems.productId, externalKey: postingItems.externalKey })
          .from(postings).innerJoin(postingItems, eq(postingItems.postingId, postings.id)).where(inArray(postings.externalId, candidateNumbers))
        : [];
      const itemsByPosting = new Map<string, typeof candidatePostingItems>();
      for (const postingItem of candidatePostingItems) itemsByPosting.set(postingItem.postingNumber, [...(itemsByPosting.get(postingItem.postingNumber) ?? []), postingItem]);
      for (const { item, id, product, mapped, destination } of prepared) {
        const offerId = asString(product.offer_id);
        const sku = asString(product.sku);
        const old = oldById.get(id);
        const apiPostingNumber = asString(item.posting_number) || null;
        const postingNumber = chooseReturnPostingNumber(apiPostingNumber, old?.postingNumber ?? null, (candidate) =>
          (itemsByPosting.get(candidate) ?? []).some((postingItem) => mapped.productId
            ? postingItem.productId === mapped.productId
            : postingItem.externalKey === mapped.externalKey),
          old?.manualReconciliationFields.includes("postingNumber") ?? false,
        );
        const returnedAtValue = item.logistic?.return_date;
        const status = asString(item.visual?.status?.display_name, asString(item.visual?.status?.sys_name, "unknown"));
        const timeline = resolveOzonReturnTimeline(item);
        const manualFields = new Set(old?.manualReconciliationFields ?? []);
        const resolveMilestone = (field: "receivedBySellerAt" | "availableAtOzon" | "writtenOffAt", target: "seller" | "ozon" | "writeoff", apiValue: Date | null) => {
          const oldValue = old?.[field] ?? null;
          if (manualFields.has(field)) return oldValue ?? apiValue;
          if (!timeline.finalStatus) return oldValue;
          if (timeline.finalStatus !== target) return null;
          return apiValue ?? oldValue;
        };
        // Receipt into the seller's stock is a manual confirmation. Ozon's
        // status remains visible in `status`/`raw`, but must not close the task.
        const receivedBySellerAt = manualFields.has("receivedBySellerAt")
          ? old?.receivedBySellerAt ?? null
          : null;
        const availableAtOzon = resolveMilestone("availableAtOzon", "ozon", timeline.availableAtOzon);
        const writtenOffAt = resolveMilestone("writtenOffAt", "writeoff", timeline.writtenOffAt);
        await db.insert(returns).values({
          externalId: id,
          postingNumber,
          externalKey: mapped.externalKey,
          offerId,
          ozonSku: sku,
          quantity: String(Math.max(0, asNumber(product.quantity))),
          destination: old?.manualReconciliationFields.includes("destination") ? old.destination : old?.destination === "unknown" ? destination : old?.destination ?? destination,
          productId: mapped.productId,
          status,
          returnedAt: typeof returnedAtValue === "string" ? new Date(returnedAtValue) : old?.returnedAt ?? null,
          receivedBySellerAt,
          writtenOffAt,
          availableAtOzon,
          raw: item as JsonRecord,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: returns.externalId,
          set: {
            postingNumber,
            externalKey: mapped.externalKey,
            productId: mapped.productId,
            offerId,
            ozonSku: sku,
            quantity: String(Math.max(0, asNumber(product.quantity))),
            destination: old?.manualReconciliationFields.includes("destination") ? old.destination : old?.destination === "unknown" ? destination : old?.destination ?? destination,
            status,
            returnedAt: typeof returnedAtValue === "string" ? new Date(returnedAtValue) : old?.returnedAt ?? null,
            receivedBySellerAt,
            writtenOffAt,
            availableAtOzon,
            raw: item as JsonRecord,
            updatedAt: new Date(),
          },
        });
        total += 1;
        if (total % 10 === 0 || total === returnsToSave.length) {
          await progress("Сохранение возвратов", { current: total, total: returnsToSave.length });
        }
      }
    }
  return total;
}

async function resolveFinanceSupplySkus(
  credentials: OzonCredentials,
  currentUnitNumbers: string[],
  progress: ProgressReporter,
) {
  const unitNumberExpression = sql<string>`${financeAccruals.raw}->>'unit_number'`;
  const isSupplyUnitNumber = sql`${unitNumberExpression} ~ '^[0-9]{12,16}$'`;
  const [resolvedRows, unresolvedRows] = await Promise.all([
    db.select({ unitNumber: unitNumberExpression, relatedSkus: financeAccruals.relatedSkus })
      .from(financeAccruals)
      .where(and(eq(financeAccruals.accruedCategory, "NON_ITEM"), isNotNull(financeAccruals.relatedSkus), isSupplyUnitNumber)),
    db.select({ unitNumber: unitNumberExpression })
      .from(financeAccruals)
      .where(and(eq(financeAccruals.accruedCategory, "NON_ITEM"), isNull(financeAccruals.relatedSkus), isSupplyUnitNumber)),
  ]);
  const cached = new Map<string, string[]>();
  for (const row of resolvedRows) {
    if (row.unitNumber && row.relatedSkus) cached.set(row.unitNumber, row.relatedSkus);
  }
  const missingUnitNumbers = [...new Set([
    ...currentUnitNumbers.filter(isOzonSupplyUnitNumber),
    ...unresolvedRows.flatMap((row) => row.unitNumber ? [row.unitNumber] : []),
  ])].filter((unitNumber) => !cached.has(unitNumber));
  if (!missingUnitNumbers.length) return cached;

  await progress("Проверка товаров в расходах по поставкам", { current: 0, total: missingUnitNumbers.length });
  const { skusBySupplyId, failedIds } = await loadOzonSupplySkus(credentials, missingUnitNumbers, (current, total) =>
    progress("Проверка товаров в расходах по поставкам", { current, total }),
  );
  if (failedIds.size) console.warn(`Не удалось связать расходы Ozon с товарами в ${failedIds.size} поставках; эти расходы останутся без товарной привязки.`);
  await db.transaction(async (tx) => {
    for (const [unitNumber, relatedSkus] of skusBySupplyId) {
      cached.set(unitNumber, relatedSkus);
      await tx.update(financeAccruals)
        .set({ relatedSkus })
        .where(and(
          eq(financeAccruals.accruedCategory, "NON_ITEM"),
          isNull(financeAccruals.relatedSkus),
          sql`${financeAccruals.raw}->>'unit_number' = ${unitNumber}`,
        ));
    }
  });
  return cached;
}

async function importDailyAccruals(credentials: OzonCredentials, from: Date, to: Date, progress: ProgressReporter) {
  const start = new Date(from);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const totalDays = Math.max(0, Math.floor((endDay - startDay) / (24 * 60 * 60 * 1000)) + 1);
  const loadedDays: { dayText: string; accruals: JsonRecord[] }[] = [];
  let loadedDayCount = 0;
  let fetched = 0;
  for (let day = start; day <= to; day = addDays(day, 1)) {
    const dayText = dateOnly(day);
    let lastId = "";
    const dailyAccruals: JsonRecord[] = [];
    let paginationComplete = false;
    for (let page = 0; page < 500; page += 1) {
      const response = await ozonPost<{ accruals?: JsonRecord[]; last_id?: string }>(
        "/v1/finance/accrual/by-day",
        { date: dayText, last_id: lastId },
        credentials,
      );
      const accruals = response.accruals ?? [];
      dailyAccruals.push(...accruals);
      lastId = response.last_id ?? "";
      if (!lastId || !accruals.length) {
        paginationComplete = true;
        break;
      }
      await sleep(100);
    }
    if (!paginationComplete) throw new Error(`Не удалось полностью загрузить начисления Ozon за ${dayText}; прежние данные сохранены.`);
    loadedDays.push({ dayText, accruals: dailyAccruals });
    fetched += dailyAccruals.length;
    loadedDayCount += 1;
    await progress(`Загрузка начислений Ozon · ${dayText}`, { current: loadedDayCount, total: totalDays });
  }

  const supplyUnitNumbers = loadedDays.flatMap(({ accruals }) => accruals.flatMap((accrual) => {
    const unitNumber = asString(accrual.unit_number);
    return asString(accrual.accrued_category).toUpperCase() === "NON_ITEM" && isOzonSupplyUnitNumber(unitNumber) ? [unitNumber] : [];
  }));
  const supplySkusByUnitNumber = await resolveFinanceSupplySkus(credentials, supplyUnitNumbers, progress);

  const fetchedTotal = fetched;
  let processed = 0;
  let total = 0;
  await progress("Сохранение финансовых операций", { current: 0, total: fetchedTotal });
  for (const { dayText, accruals: dailyAccruals } of loadedDays) {
    const paginationComplete = true;
    const seenKeys = new Set<string>();
    const legacyPostingNumbers = new Set<string>();
    const preparedRows: {
      externalKey: string;
      postingNumber: string | null;
      productId: string | null;
      accrualId: string;
      accruedCategory: string;
      typeId: string;
      amount: string;
      relatedSkus: string[];
      raw: JsonRecord;
    }[] = [];
    for (const accrual of dailyAccruals) {
      const unitNumber = asString(accrual.unit_number);
      const category = asString(accrual.accrued_category, "unknown");
      const accrualId = asString(accrual.accrual_id ?? accrual.type_id);
      const nonItemFee = accrual.non_item_fee as { type_id?: unknown } | undefined;
      const postingNumber = financeAccrualPostingNumber(category, unitNumber, asString(nonItemFee?.type_id));
      if (postingNumber) legacyPostingNumbers.add(postingNumber);
      const supplySkus = category.toUpperCase() === "NON_ITEM" ? supplySkusByUnitNumber.get(unitNumber) : undefined;
      const itemFees = accrual.item_fees as { fees?: { sku?: unknown; fees?: { accrued?: unknown; type_id?: unknown }[] }[] } | undefined;
      const containerFees = accrual.container_fees as { fees?: { accrued?: unknown; type_id?: unknown }[] } | undefined;
      const financeRows: { suffix: string; productId: string | null; amount: number; typeId: string; relatedSkus: string[] }[] = [];
      if (category.toUpperCase() === "ITEM" && itemFees?.fees?.length) {
        for (const itemFee of itemFees.fees) {
          const sku = asString(itemFee.sku);
          const fees = itemFee.fees ?? [];
          const external = sku
            ? await resolveExternalProduct({ sku, name: `Ozon SKU ${sku}` }, accrual)
            : { productId: null };
          for (const feeGroup of groupFinanceItemFees(fees)) {
            financeRows.push({
              suffix: `sku:${sku}:type:${feeGroup.typeId}`,
              productId: external.productId,
              amount: feeGroup.amount,
              typeId: feeGroup.typeId,
              relatedSkus: sku ? [sku] : [],
            });
          }
        }
      }
      if (containerFees?.fees?.length) {
        for (const feeGroup of groupFinanceItemFees(containerFees.fees)) {
          financeRows.push({
            suffix: `container:type:${feeGroup.typeId}`,
            productId: null,
            amount: feeGroup.amount,
            typeId: feeGroup.typeId,
            relatedSkus: supplySkus ?? [],
          });
        }
      }
      if (!financeRows.length) {
        const totalAmount = accrual.total_amount as { amount?: unknown } | undefined;
        financeRows.push({
          suffix: "",
          productId: null,
          amount: moneyAmount(totalAmount),
          typeId: asString(nonItemFee?.type_id, accrualId),
          relatedSkus: supplySkus ?? financeAccrualRelatedSkus({ externalKey: "", raw: accrual, relatedSkus: null }),
        });
      }

      for (const financeRow of financeRows) {
        const fingerprint = createHash("sha256").update(JSON.stringify(accrual)).digest("hex").slice(0, 24);
        const stableId = accrualId || fingerprint;
        const externalKey = `${dayText}:${category}:${unitNumber}:${stableId}:${financeRow.suffix}`;
        seenKeys.add(externalKey);
        preparedRows.push({
          externalKey,
          postingNumber,
          productId: financeRow.productId,
          accrualId,
          accruedCategory: category,
          typeId: financeRow.typeId,
          amount: String(financeRow.amount),
          relatedSkus: financeRow.relatedSkus,
          raw: accrual,
        });
      }
    }
    total += preparedRows.length;
    await db.transaction(async (tx) => {
      for (const row of preparedRows) {
        await tx.insert(financeAccruals).values({ ...row, accrualDate: dayText }).onConflictDoUpdate({
          target: financeAccruals.externalKey,
          set: {
            postingNumber: row.postingNumber,
            productId: row.productId,
            accrualId: row.accrualId,
            accruedCategory: row.accruedCategory,
            typeId: row.typeId,
            amount: row.amount,
            relatedSkus: row.relatedSkus,
            raw: row.raw,
          },
        });
      }
      if (legacyPostingNumbers.size) {
        await tx.delete(financeAccruals).where(and(inArray(financeAccruals.postingNumber, [...legacyPostingNumbers]), eq(financeAccruals.accrualId, "imported")));
      }
      const oldRows = await tx.select({ externalKey: financeAccruals.externalKey }).from(financeAccruals).where(eq(financeAccruals.accrualDate, dayText));
      const obsoleteKeys = staleOzonAccrualKeys(dayText, oldRows.map((row) => row.externalKey), seenKeys, paginationComplete);
      if (obsoleteKeys.length) await tx.delete(financeAccruals).where(inArray(financeAccruals.externalKey, obsoleteKeys));
    });
    processed += dailyAccruals.length;
    await progress("Сохранение финансовых операций", { current: processed, total: fetchedTotal });
    await sleep(200);
  }
  return { days: loadedDays.length, accruals: total };
}

async function downloadOzonCompensationReport(credentials: OzonCredentials, reportMonth: string) {
  type ReportResponse = { result?: JsonRecord; code?: unknown };
  const created = await ozonPost<ReportResponse>(
    "/v1/finance/compensation",
    { date: reportMonth, language: "RU" },
    credentials,
  );
  const createdResult = asRecord(created.result) ?? {};
  const code = asString(createdResult.code ?? createdResult.report_id ?? created.code);
  if (!code) throw new Error(`Ozon не выдал номер отчёта о компенсациях за ${reportMonth}.`);

  let reportInfo: JsonRecord = createdResult;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (attempt > 0 || !asString(reportInfo.file)) {
      const response = await ozonPost<ReportResponse>("/v1/report/info", { code }, credentials);
      reportInfo = asRecord(response.result) ?? {};
    }
    const status = asString(reportInfo.status).toLowerCase();
    const fileUrl = asString(reportInfo.file);
    if (status === "success" && fileUrl) {
      const url = new URL(fileUrl);
      if (url.protocol !== "https:") throw new Error(`Ozon выдал небезопасную ссылку на отчёт за ${reportMonth}.`);
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
      if (!response.ok) throw new Error(`Не удалось скачать отчёт о компенсациях Ozon за ${reportMonth} (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return parseOzonCompensationXlsx(bytes, reportMonth);
    }
    if (["error", "failed", "failure"].includes(status)) {
      throw new Error(asString(reportInfo.error) || `Ozon не сформировал отчёт о компенсациях за ${reportMonth}.`);
    }
    await sleep(1_000);
  }
  throw new Error(`Ozon не завершил формирование отчёта о компенсациях за ${reportMonth} за отведённое время.`);
}

async function importOzonCompensationReports(credentials: OzonCredentials, from: Date, to: Date, progress: ProgressReporter) {
  const rows = await db.select({ accrualDate: financeAccruals.accrualDate })
    .from(financeAccruals)
    .where(and(
      inArray(financeAccruals.typeId, ["10", "25"]),
      gte(financeAccruals.accrualDate, dateOnly(from)),
      lte(financeAccruals.accrualDate, dateOnly(to)),
    ));
  const months = [...new Set(rows.map((row) => row.accrualDate.slice(0, 7)))].sort();
  if (!months.length) return { months: 0, lines: 0 };

  const existing = await db.select({ reportMonth: ozonCompensationReports.reportMonth }).from(ozonCompensationReports);
  const existingMonths = new Set(existing.map((row) => row.reportMonth));
  const firstRefreshMonth = dateOnly(from).slice(0, 7);
  const monthsToImport = months.filter((month) => !existingMonths.has(month) || month >= firstRefreshMonth);
  let lineCount = 0;
  for (const [index, month] of monthsToImport.entries()) {
    await progress(`Загрузка отчёта о компенсациях Ozon · ${month}`, { current: index, total: monthsToImport.length });
    const report = await downloadOzonCompensationReport(credentials, month);
    await db.insert(ozonCompensationReports).values({
      reportMonth: report.reportMonth,
      reportNumber: report.reportNumber,
      lines: report.lines,
      syncedAt: new Date(),
    }).onConflictDoUpdate({
      target: ozonCompensationReports.reportMonth,
      set: { reportNumber: report.reportNumber, lines: report.lines, syncedAt: new Date() },
    });
    lineCount += report.lines.length;
    await progress(`Отчёт о компенсациях Ozon · ${month}`, { current: index + 1, total: monthsToImport.length });
  }
  return { months: monthsToImport.length, lines: lineCount };
}

async function importOzonPayouts(credentials: OzonCredentials, from: Date, to: Date, progress: ProgressReporter) {
  type PayoutResponse = {
    result?: { cash_flows?: JsonRecord[]; details?: JsonRecord | JsonRecord[]; page_count?: number };
    page_count?: number;
  };
  const requestPage = (page: number) => ozonPost<PayoutResponse>(
    "/v1/finance/cash-flow-statement/list",
    { date: { from: from.toISOString(), to: to.toISOString() }, with_details: true, page, page_size: 1 },
    credentials,
  );
  const firstPage = await requestPage(1);
  const pageCount = Number(firstPage.page_count ?? firstPage.result?.page_count);
  if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 500) {
    throw new Error("Ozon вернул некорректное число страниц отчёта о выплатах; сохранённые выплаты не изменены.");
  }
  const payoutRows: {
    externalKey: string;
    periodId: string;
    periodBegin: string;
    periodEnd: string;
    currencyCode: string;
    amount: string;
    raw: JsonRecord;
  }[] = [];
  const seenKeysByPeriod = new Map<string, Set<string>>();
  const reports: { periodId: string; page: number }[] = [];

  for (let page = 1; page <= pageCount; page += 1) {
    const response = page === 1 ? firstPage : await requestPage(page);
    const result = asRecord(response.result) ?? {};
    const rawDetails = result.details;
    const details = Array.isArray(rawDetails)
      ? asRecord(rawDetails[0])
      : asRecord(rawDetails);
    const rawCashFlows: unknown[] = Array.isArray(result.cash_flows) ? result.cash_flows : [];
    const cashFlows = rawCashFlows.map((item: unknown) => asRecord(item) ?? {});
    const period = asRecord(details?.period) ?? asRecord(cashFlows[0]?.period);
    const periodId = asString(period?.id);
    const periodBegin = typeof period?.begin === "string" ? dateOnly(new Date(period.begin)) : "";
    const periodEnd = typeof period?.end === "string" ? dateOnly(new Date(period.end)) : "";
    if (!details || !periodId || !Number.isFinite(Date.parse(`${periodBegin}T00:00:00.000Z`)) || !Number.isFinite(Date.parse(`${periodEnd}T00:00:00.000Z`))) {
      throw new Error(`Ozon не вернул детализацию периода на странице ${page}; сохранённые выплаты не изменены.`);
    }
    const stablePeriodId = `${periodId}:${periodBegin}:${periodEnd}`;

    const paymentsValue = details.payments;
    const payments = Array.isArray(paymentsValue)
      ? paymentsValue.map((item) => asRecord(item) ?? {})
      : paymentsValue && typeof paymentsValue === "object" ? [asRecord(paymentsValue) ?? {}] : [];
    const byCurrency = new Map<string, { cents: number; payments: JsonRecord[] }>();
    for (const payment of payments) {
      const paymentAmount = Number(payment.payment);
      if (!Number.isFinite(paymentAmount)) throw new Error(`Ozon вернул некорректную сумму выплаты за период ${periodBegin}–${periodEnd}.`);
      const currencyCode = asString(payment.currency_code, "RUB").trim().toUpperCase() || "RUB";
      const group = byCurrency.get(currencyCode) ?? { cents: 0, payments: [] };
      // Ozon reports payments from its own cash-flow perspective: transfers to the seller are negative.
      group.cents -= Math.round(paymentAmount * 100);
      group.payments.push(payment);
      byCurrency.set(currencyCode, group);
    }

    const periodKeys = seenKeysByPeriod.get(stablePeriodId) ?? new Set<string>();
    for (const [currencyCode, group] of byCurrency) {
      const externalKey = `cash-flow:${stablePeriodId}:${currencyCode}`;
      periodKeys.add(externalKey);
      payoutRows.push({
        externalKey,
        periodId: stablePeriodId,
        periodBegin,
        periodEnd,
        currencyCode,
        amount: (group.cents / 100).toFixed(2),
        raw: { period, payments: group.payments, cashFlows, details },
      });
    }
    seenKeysByPeriod.set(stablePeriodId, periodKeys);
    reports.push({ periodId: stablePeriodId, page });
    await progress("Загрузка выплат Ozon", { current: page, total: pageCount });
  }

  await db.transaction(async (tx) => {
    await tx.delete(ozonPayouts).where(eq(ozonPayouts.periodId, "0"));
    for (const row of payoutRows) {
      await tx.insert(ozonPayouts).values(row).onConflictDoUpdate({
        target: ozonPayouts.externalKey,
        set: {
          periodId: row.periodId,
          periodBegin: row.periodBegin,
          periodEnd: row.periodEnd,
          currencyCode: row.currencyCode,
          amount: row.amount,
          raw: row.raw,
          updatedAt: new Date(),
        },
      });
    }
    for (const [periodId, seenKeys] of seenKeysByPeriod) {
      const existingRows = await tx.select({ externalKey: ozonPayouts.externalKey }).from(ozonPayouts).where(eq(ozonPayouts.periodId, periodId));
      const obsoleteKeys = existingRows.map((row) => row.externalKey).filter((key) => !seenKeys.has(key));
      if (obsoleteKeys.length) await tx.delete(ozonPayouts).where(inArray(ozonPayouts.externalKey, obsoleteKeys));
    }
  });

  const totalsByCurrency = new Map<string, number>();
  for (const row of payoutRows) totalsByCurrency.set(row.currencyCode, (totalsByCurrency.get(row.currencyCode) ?? 0) + Number(row.amount));
  return { periods: reports.length, payments: payoutRows.length, totalsByCurrency: Object.fromEntries(totalsByCurrency) };
}

async function importBuyoutReports(credentials: OzonCredentials, from: Date, to: Date, progress: ProgressReporter) {
  const supportedRange = supportedOzonBuyoutRange(from, to);
  if (!supportedRange) return 0;
  const fetched: JsonRecord[] = [];
  for (let current = supportedRange.from; current <= supportedRange.to;) {
    const rangeEnd = new Date(Math.min(addDays(current, 30).getTime(), supportedRange.to.getTime()));
    const response = await ozonPost<{ products?: JsonRecord[] }>(
      "/v1/finance/products/buyout",
      { date_from: dateOnly(current), date_to: dateOnly(rangeEnd) },
      credentials,
    );
    fetched.push(...(response.products ?? []));
    await progress(`Загружено записей о выкупах: ${fetched.length}`);
    current = addDays(rangeEnd, 1);
  }
  let productsFound = 0;
  await progress("Сохранение данных о выкупах", { current: 0, total: fetched.length });
  for (const product of fetched) {
      const postingNumber = asString(product.posting_number);
      const sku = asString(product.sku);
      const offerId = asString(product.offer_id);
      const links = await db.select().from(productLinks).where(eq(productLinks.offerId, offerId));
      const link = links.find((entry) => entry.ozonSku === sku) ?? (!sku ? links[0] : undefined);
      const posting = await db.select().from(postings).where(eq(postings.externalId, postingNumber)).limit(1);
      if (posting[0]) {
        const lineItems = await db.select().from(postingItems).where(eq(postingItems.postingId, posting[0].id));
        const matchingItems = matchBuyoutLines(lineItems, { sku, offerId });
        if (matchingItems.length) {
          const observedAt = new Date();
          await db.update(postingItems).set({
            isMarketplaceBuyout: true,
          }).where(inArray(postingItems.id, matchingItems.map((item) => item.id)));
          const amount = marketplaceBuyoutAmount(product);
          if (amount !== null) {
            await db.update(postingItems).set({ marketplaceBuyoutAmount: amount }).where(eq(postingItems.id, matchingItems[0].id));
          }
          const refreshedItems = await db.select().from(postingItems).where(eq(postingItems.postingId, posting[0].id));
          const allItemsAreMarketplaceBuyouts = refreshedItems.length > 0 && refreshedItems.every((item) => item.isMarketplaceBuyout);
          await db.update(postings).set({
            isMarketplaceBuyout: allItemsAreMarketplaceBuyouts,
            updatedAt: observedAt,
          }).where(eq(postings.id, posting[0].id));
        }
      }
      if (!link && offerId) await resolveExternalProduct(product as ExternalProduct, product);
      productsFound += 1;
      if (productsFound % 10 === 0 || productsFound === fetched.length) {
        await progress("Сохранение данных о выкупах", { current: productsFound, total: fetched.length });
      }
    }
  return productsFound;
}

async function importWriteoffs(credentials: OzonCredentials, from: Date, to: Date, progress: ProgressReporter) {
  const fetched: JsonRecord[] = [];
  let pages = 0;
  const ranges = splitUtcDateRange(from, to, MAX_HISTORY_RANGE_DAYS);
  for (const range of ranges) {
    let page = 1;
    let fetchedInRange = 0;
    while (page <= 10_000 && pages < 10_000) {
      const response = await ozonPost<{ items?: JsonRecord[]; total_count?: number }>(
        "/v1/analytics/decommissioned-goods",
        {
          filter: { date_from: range.from.toISOString(), date_to: range.to.toISOString(), delivery_schema: "FBO" },
          page,
          page_size: 99,
          sort_by: "DATE",
          sort_dir: "ASC",
        },
        credentials,
      );
      const items = response.items ?? [];
      fetched.push(...items);
      fetchedInRange += items.length;
      pages += 1;
      await progress(`Загружено списаний: ${fetched.length}`);
      if (!items.length || items.length < 99 || (response.total_count !== undefined && fetchedInRange >= response.total_count)) break;
      page += 1;
      await sleep(250);
    }
    if (pages >= 10_000) break;
  }

  const uniqueItems = [...new Map(fetched.map((item) => {
    const key = `${asString(item.posting_number)}:${asString(item.sku)}:${asString(item.date)}:${asString(item.dispose_reason)}`;
    return [key, item] as const;
  })).values()];
  let imported = 0;
  await progress("Сохранение списаний", { current: 0, total: uniqueItems.length });
  for (const item of uniqueItems) {
        const sku = asString(item.sku);
        const postingNumber = asString(item.posting_number);
        const happenedAt = asString(item.date);
        const key = `${postingNumber}:${sku}:${happenedAt}:${asString(item.dispose_reason)}`;
        const candidate = { offer_id: "", sku, name: `Ozon SKU ${sku}` };
        const productId = (await resolveExternalProduct(candidate, item)).productId;
        await db.insert(ozonWriteoffs).values({
          externalId: key,
          productId,
          externalKey: externalKey("", sku),
          offerId: "",
          ozonSku: sku,
          quantity: String(Math.max(0, asNumber(item.quantity))),
          compensationStatus: asString(item.compensation_type, "unknown"),
          compensationAmount: String(asNumber(item.compensation_price)),
          occurredAt: happenedAt ? new Date(happenedAt) : null,
          raw: item,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: ozonWriteoffs.externalId,
          set: {
            productId,
            quantity: String(Math.max(0, asNumber(item.quantity))),
            compensationStatus: asString(item.compensation_type, "unknown"),
            compensationAmount: String(asNumber(item.compensation_price)),
            raw: item,
            updatedAt: new Date(),
          },
        });
        imported += 1;
        if (imported % 10 === 0 || imported === uniqueItems.length) {
          await progress("Сохранение списаний", { current: imported, total: uniqueItems.length });
        }
    }
  return imported;
}

export async function syncOzonData(jobId: string) {
  const [job] = await db.select({ kind: syncJobs.kind }).from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
  const kind = job?.kind ?? "full";
  const settings = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  const settingsRow = settings[0];
  if (!settingsRow?.ozonClientId || !settingsRow.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
  if (!settingsRow.accountingStartDate) throw new Error("Сначала укажи дату начала учёта в настройках.");
  const credentials: OzonCredentials = { clientId: settingsRow.ozonClientId, apiKey: decryptSecret(settingsRow.ozonApiKeyEncrypted) };
  const now = new Date();
  const startDate = settingsRow.accountingStartDate;
  const { from, to } = resolveOzonSyncRange(startDate, settingsRow.lastSyncAt ?? null, now);
  const errors: string[] = [];
  const summary: JsonRecord = {
    requestedKind: kind,
    accountingStartDate: startDate,
    queriedFrom: from.toISOString(),
    queriedTo: to.toISOString(),
    progress: "Подготовка к загрузке данных",
  };
  await db.update(syncJobs).set({ summary: { ...summary }, heartbeatAt: new Date() }).where(eq(syncJobs.id, jobId));
  const progress: ProgressReporter = async (label, counts) => {
    await db.update(syncJobs).set({
      summary: {
        ...summary,
        progress: label,
        progressCurrent: counts?.current ?? null,
        progressTotal: counts?.total ?? null,
      },
      heartbeatAt: new Date(),
    }).where(eq(syncJobs.id, jobId));
  };
  const stageLabels: Record<string, string> = {
    orders: "Загрузка заказов FBO",
    returns: "Загрузка возвратов",
    buyouts: "Загрузка отчётов о выкупах Ozon",
    accruals: "Загрузка финансовых начислений Ozon",
    compensationReports: "Загрузка расшифровок компенсаций Ozon",
    payouts: "Загрузка отчётов о выплатах Ozon",
    writeoffs: "Загрузка списаний Ozon",
    supplyIds: "Сопоставление поставок Ozon",
    supplyLabels: "Сохранение этикеток грузомест",
    supplyCosts: "Сверка доставки Ozon по поставкам",
  };
  const run = async (label: string, task: () => Promise<unknown>, range = { from, to }) => {
    try {
      summary.currentQueriedFrom = range.from.toISOString();
      summary.currentQueriedTo = range.to.toISOString();
      await progress(stageLabels[label] ?? `Загрузка ${label}`);
      const result = await task();
      summary[label] = result;
      return { ok: true as const, result };
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      summary[label] = "ошибка";
      return { ok: false as const, result: null };
    }
  };
  const syncBuyoutReports = async (ordersImported: boolean) => {
    const needsBackfill = settingsRow.marketplaceBuyoutReportStartDate !== startDate;
    const reportFrom = needsBackfill ? new Date(`${startDate}T00:00:00.000Z`) : from;
    const buyoutRun = await run("buyouts", () => importBuyoutReports(credentials, reportFrom, to, progress), { from: reportFrom, to });
    if (needsBackfill && ordersImported && buyoutRun.ok) {
      await db.update(appSettings).set({ marketplaceBuyoutReportStartDate: startDate, updatedAt: new Date() }).where(eq(appSettings.id, 1));
    }
  };

  const hasOzonSharedExpenseHistory = settingsRow.ozonSharedExpenseHistoryStartDate === startDate;
  const accrualFrom = hasOzonSharedExpenseHistory ? from : new Date(`${startDate}T00:00:00.000Z`);
  const hasOzonCompensationReportHistory = settingsRow.ozonCompensationReportHistoryStartDate === startDate;
  const compensationFrom = hasOzonCompensationReportHistory ? from : new Date(`${startDate}T00:00:00.000Z`);
  const syncAccruals = async () => {
    summary.ozonSharedExpenseHistoryFrom = accrualFrom.toISOString();
    const supplyIdRun = await run("supplyIds", () => reconcileOzonSupplyIds(credentials, progress), { from: accrualFrom, to });
    if (supplyIdRun.ok) summary.ozonSupplyIdReconciliation = supplyIdRun.result;
    const supplyLabelsRun = await run("supplyLabels", () => reconcileOzonSupplyLabels(credentials, progress), { from: accrualFrom, to });
    if (supplyLabelsRun.ok) summary.ozonSupplyLabels = supplyLabelsRun.result;
    const accrualRun = await run("accruals", () => importDailyAccruals(credentials, accrualFrom, to, progress), { from: accrualFrom, to });
    if (accrualRun.ok && !hasOzonSharedExpenseHistory) {
      await db.update(appSettings)
        .set({ ozonSharedExpenseHistoryStartDate: startDate, updatedAt: new Date() })
        .where(eq(appSettings.id, 1));
      summary.ozonSharedExpenseHistoryStartDate = startDate;
    }
    if (!accrualRun.ok) return;
    const supplyCostRun = await run("supplyCosts", reconcileOzonSupplyCosts, { from: accrualFrom, to });
    if (supplyCostRun.ok) summary.ozonSupplyCosts = supplyCostRun.result;
    summary.ozonCompensationReportHistoryFrom = compensationFrom.toISOString();
    const reportRun = await run("compensationReports", () => importOzonCompensationReports(credentials, compensationFrom, to, progress), { from: compensationFrom, to });
    if (reportRun.ok && !hasOzonCompensationReportHistory) {
      await db.update(appSettings)
        .set({ ozonCompensationReportHistoryStartDate: startDate, updatedAt: new Date() })
        .where(eq(appSettings.id, 1));
      summary.ozonCompensationReportHistoryStartDate = startDate;
    }
  };

  const existingPayoutPeriods = await db.select({ periodId: ozonPayouts.periodId }).from(ozonPayouts);
  const hasCollapsedLegacyPayouts = existingPayoutPeriods.some((row) => row.periodId === "0" || !row.periodId.includes(":"));
  const hasOzonPayoutHistory = settingsRow.ozonPayoutHistoryStartDate === startDate && !hasCollapsedLegacyPayouts;
  const payoutFrom = kind === "payouts_full"
    ? new Date(`${startDate}T00:00:00.000Z`)
    : hasOzonPayoutHistory ? from : new Date(`${startDate}T00:00:00.000Z`);
  const syncPayouts = async () => {
    summary.ozonPayoutHistoryFrom = payoutFrom.toISOString();
    const payoutRun = await run("payouts", () => importOzonPayouts(credentials, payoutFrom, to, progress), { from: payoutFrom, to });
    if (payoutRun.ok && !hasOzonPayoutHistory) {
      await db.update(appSettings)
        .set({ ozonPayoutHistoryStartDate: startDate, updatedAt: new Date() })
        .where(eq(appSettings.id, 1));
      summary.ozonPayoutHistoryStartDate = startDate;
    }
  };

  if (kind === "labels") {
    const labelsRun = await run("supplyLabels", () => reconcileOzonSupplyLabels(credentials, progress));
    if (labelsRun.ok) summary.ozonSupplyLabels = labelsRun.result;
    if (errors.length) summary.warnings = errors;
    return summary;
  }

  const fullSync = ["scheduled", "manual", "full"].includes(kind);
  if (kind === "payouts" || kind === "payouts_full") {
    await syncPayouts();
  } else if (kind === "orders") {
    const ordersRun = await run("orders", () => importPostings(credentials, from, to, progress));
    await syncBuyoutReports(ordersRun.ok);
    await syncAccruals();
    await syncPayouts();
  } else if (kind === "returns") {
    await run("returns", () => importReturns(credentials, from, to, progress));
    await syncAccruals();
    await syncPayouts();
  } else {
    const ordersRun = await run("orders", () => importPostings(credentials, from, to, progress));
    await run("returns", () => importReturns(credentials, from, to, progress));
    await syncBuyoutReports(ordersRun.ok);
    await syncAccruals();
    await syncPayouts();
    await run("writeoffs", () => importWriteoffs(credentials, from, to, progress));
  }
  try {
    const history = await getAccountingSnapshot(new Date(), true);
    await persistAddedCostRateSnapshots(history);
  } catch (error) {
    errors.push(`addedCostRates: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (fullSync && !errors.length) await db.update(appSettings).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(appSettings.id, 1));
  if (errors.length) summary.warnings = errors;
  return summary;
}

export async function claimNextJob() {
  const connection = await db.execute(sql`UPDATE sync_jobs SET status = 'running', started_at = now(), heartbeat_at = now() WHERE id = (SELECT id FROM sync_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`);
  const row = connection.rows[0] as { id?: string } | undefined;
  return row?.id ?? null;
}
