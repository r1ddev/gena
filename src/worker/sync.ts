import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import {
  appSettings,
  externalItems,
  financeAccruals,
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
import { financeAccrualPostingNumber, groupFinanceItemFees, matchBuyoutLines, staleOzonAccrualKeys, supportedOzonBuyoutRange } from "@/ozon/finance";
import { observeBuyerHandoffAt } from "@/ozon/postings";
import { chooseReturnPostingNumber } from "@/ozon/returns";
import { chooseExternalProductRecord, dispositionAfterProductLink, exactProductLinkForOffer, externalProductKey, resolveExternalProductLink } from "@/ozon/external-product";

type JsonRecord = Record<string, unknown>;
type ExternalProduct = { offer_id?: unknown; sku?: unknown; name?: unknown; quantity?: unknown; price?: unknown; is_marketplace_buyout?: unknown };
type FboPosting = { posting_number?: unknown; order_number?: unknown; status?: unknown; created_at?: unknown; products?: ExternalProduct[]; [key: string]: unknown };
type OzonCredentials = { clientId: string; apiKey: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asString = (value: unknown, fallback = "") => value === undefined || value === null ? fallback : String(value);
const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const moneyAmount = (value: unknown) => asNumber(typeof value === "object" && value !== null && "amount" in value ? (value as { amount?: unknown }).amount : value);
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, amount: number) => new Date(date.getTime() + amount * 24 * 60 * 60 * 1000);

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

  const link = exactLink
    ?? skuLinks.find((candidate) => candidate.ozonSku === sku)
    ?? links.find((candidate) => !candidate.ozonSku);
  const resolutionDisposition = exactLink
    ? dispositionAfterProductLink(previous?.disposition ?? "pending")
    : previous?.disposition ?? "pending";
  const resolution = resolveExternalProductLink(resolutionDisposition, previous?.productId ?? null, link?.productId ?? null);
  if (link) {
    const disposition = dispositionAfterProductLink(previous?.disposition ?? "pending");
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

  await db.insert(externalItems).values({
    externalKey: key,
    offerId,
    ozonSku: sku,
    title: asString(product.name, "Без названия"),
    disposition: previous?.disposition ?? "pending",
    productId: resolution.productId,
    raw,
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: externalItems.externalKey,
    set: { title: asString(product.name, "Без названия"), raw, lastSeenAt: new Date() },
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
    const deliveredAt = observeBuyerHandoffAt(existing?.deliveredAt ?? null, status, new Date());
    const allItemsAreMarketplaceBuyouts = mappedProducts.length > 0 && mappedProducts.every(({ product, mapped }) =>
      product.is_marketplace_buyout === true || oldItemByKey.get(mapped.externalKey)?.isMarketplaceBuyout === true,
    );
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
        raw: product as JsonRecord,
      };
    }));
  });
  return true;
}

async function importPostings(credentials: OzonCredentials, from: Date, to: Date, progress: (label: string) => Promise<void>) {
  let cursor = "";
  let total = 0;
  let pages = 0;
  do {
    const response = await ozonPost<{ postings?: FboPosting[]; cursor?: string; has_next?: boolean; result?: { postings?: FboPosting[]; cursor?: string; has_next?: boolean } }>(
      "/v3/posting/fbo/list",
      {
        cursor: cursor || undefined,
        filter: { since: from.toISOString(), to: to.toISOString() },
        limit: 100,
        sort_dir: "ASC",
        with: { financial_data: true, analytics_data: false, legal_info: false },
      },
      credentials,
    );
    const page = response.postings ?? response.result?.postings ?? [];
    for (const posting of page) {
      if (await upsertFboPosting(posting)) total += 1;
    }
    pages += 1;
    await progress(`Заказы FBO: обработано ${total} отправлений, страниц ${pages}`);
    cursor = response.cursor ?? response.result?.cursor ?? "";
    if (!(response.has_next ?? response.result?.has_next) || !cursor || pages > 10_000) break;
    await sleep(250);
  } while (true);
  return total;
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

async function importReturns(credentials: OzonCredentials, from: Date, to: Date, progress: (label: string) => Promise<void>) {
  let lastId = 0;
  let total = 0;
  let pages = 0;
  while (pages < 10_000) {
    const response = await ozonPost<{ returns?: OzonReturn[]; has_next?: boolean }>(
      "/v1/returns/list",
      {
        filter: { visual_status_change_moment: { time_from: from.toISOString(), time_to: to.toISOString() } },
        limit: 500,
        ...(lastId ? { last_id: lastId } : {}),
      },
      credentials,
    );
    const page = response.returns ?? [];
    if (page.length === 0) break;
    const prepared = (await Promise.all(page.map(async (item) => {
      const id = asString(item.id);
      if (!id) return null;
      const product = item.product ?? {};
      return { item, id, product, mapped: await resolveExternalProduct(product, item as JsonRecord), destination: guessReturnDestination(item) };
    }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
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
      const status = asString(item.visual?.status?.sys_name, asString(item.visual?.status?.display_name, "unknown"));
      await db.insert(returns).values({
        externalId: id,
        postingNumber,
        externalKey: mapped.externalKey,
        productId: mapped.productId,
        offerId,
        ozonSku: sku,
        quantity: String(Math.max(0, asNumber(product.quantity))),
        destination: old?.manualReconciliationFields.includes("destination") ? old.destination : old?.destination === "unknown" ? destination : old?.destination ?? destination,
        status,
        returnedAt: typeof returnedAtValue === "string" ? new Date(returnedAtValue) : old?.returnedAt ?? null,
        receivedBySellerAt: old?.receivedBySellerAt ?? null,
        availableAtOzon: old?.availableAtOzon ?? null,
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
          receivedBySellerAt: old?.receivedBySellerAt ?? null,
          raw: item as JsonRecord,
          updatedAt: new Date(),
        },
      });
      total += 1;
      lastId = Math.max(lastId, asNumber(item.id));
    }
    pages += 1;
    await progress(`Возвраты: обновлено ${total}, страниц ${pages}`);
    if (!response.has_next || page.length < 500 || pages > 10_000) break;
    await sleep(250);
  }
  return total;
}

async function importDailyAccruals(credentials: OzonCredentials, from: Date, to: Date, progress: (label: string) => Promise<void>) {
  const start = new Date(from);
  let days = 0;
  let total = 0;
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
      raw: JsonRecord;
    }[] = [];
    for (const accrual of dailyAccruals) {
      const unitNumber = asString(accrual.unit_number);
      const category = asString(accrual.accrued_category, "unknown");
      const accrualId = asString(accrual.accrual_id ?? accrual.type_id);
      const postingNumber = financeAccrualPostingNumber(category, unitNumber);
      if (postingNumber) legacyPostingNumbers.add(postingNumber);
      const itemFees = accrual.item_fees as { fees?: { sku?: unknown; fees?: { accrued?: unknown; type_id?: unknown }[] }[] } | undefined;
      const financeRows: { suffix: string; productId: string | null; amount: number; typeId: string }[] = [];
      if (category.toUpperCase() === "ITEM" && itemFees?.fees?.length) {
        for (const itemFee of itemFees.fees) {
          const sku = asString(itemFee.sku);
          const fees = itemFee.fees ?? [];
          const external = sku
            ? await resolveExternalProduct({ sku, name: `Ozon SKU ${sku}` }, itemFee as JsonRecord)
            : { productId: null };
          for (const feeGroup of groupFinanceItemFees(fees)) {
            financeRows.push({
              suffix: `sku:${sku}:type:${feeGroup.typeId}`,
              productId: external.productId,
              amount: feeGroup.amount,
              typeId: feeGroup.typeId,
            });
          }
        }
      } else {
        const totalAmount = accrual.total_amount as { amount?: unknown } | undefined;
        financeRows.push({ suffix: "", productId: null, amount: moneyAmount(totalAmount), typeId: accrualId });
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
    days += 1;
    if (days % 10 === 0 || dayText === dateOnly(to)) await progress(`Начисления Ozon: ${days} дней, ${total} строк; до ${dayText}`);
    await sleep(200);
  }
  return { days, accruals: total };
}

async function importBuyoutReports(credentials: OzonCredentials, from: Date, to: Date, progress: (label: string) => Promise<void>) {
  let reports = 0;
  let productsFound = 0;
  const supportedRange = supportedOzonBuyoutRange(from, to);
  if (!supportedRange) return 0;
  for (let current = supportedRange.from; current <= supportedRange.to;) {
    const rangeEnd = new Date(Math.min(addDays(current, 30).getTime(), supportedRange.to.getTime()));
    const response = await ozonPost<{ products?: JsonRecord[] }>(
      "/v1/finance/products/buyout",
      { date_from: dateOnly(current), date_to: dateOnly(rangeEnd) },
      credentials,
    );
    for (const product of response.products ?? []) {
      const postingNumber = asString(product.posting_number);
      const sku = asString(product.sku);
      const offerId = asString(product.offer_id);
      const links = await db.select().from(productLinks).where(eq(productLinks.offerId, offerId));
      const link = links.find((entry) => entry.ozonSku === sku) ?? links.find((entry) => !entry.ozonSku);
      const posting = await db.select().from(postings).where(eq(postings.externalId, postingNumber)).limit(1);
      if (posting[0]) {
        const lineItems = await db.select().from(postingItems).where(eq(postingItems.postingId, posting[0].id));
        const matchingItems = matchBuyoutLines(lineItems, { sku, offerId });
        if (matchingItems.length) {
          const observedAt = new Date();
          await db.update(postingItems).set({
            isMarketplaceBuyout: true,
            marketplaceBuyoutAt: sql`COALESCE(${postingItems.marketplaceBuyoutAt}, ${observedAt})`,
          }).where(inArray(postingItems.id, matchingItems.map((item) => item.id)));
          const refreshedItems = await db.select().from(postingItems).where(eq(postingItems.postingId, posting[0].id));
          const allItemsAreMarketplaceBuyouts = refreshedItems.length > 0 && refreshedItems.every((item) => item.isMarketplaceBuyout);
          await db.update(postings).set({
            isMarketplaceBuyout: allItemsAreMarketplaceBuyouts,
            marketplaceBuyoutAt: allItemsAreMarketplaceBuyouts ? sql`COALESCE(${postings.marketplaceBuyoutAt}, ${observedAt})` : posting[0].marketplaceBuyoutAt,
            updatedAt: observedAt,
          }).where(eq(postings.id, posting[0].id));
        }
      }
      if (!link && offerId) await resolveExternalProduct(product as ExternalProduct, product);
      productsFound += 1;
    }
    reports += 1;
    await progress(`Отчёты о выкупах Ozon: ${reports} периодов, ${productsFound} товаров`);
    current = addDays(rangeEnd, 1);
    await sleep(250);
  }
  return productsFound;
}

async function importWriteoffs(credentials: OzonCredentials, from: Date, to: Date, progress: (label: string) => Promise<void>) {
  let page = 1;
  let imported = 0;
  while (page <= 10_000) {
    const response = await ozonPost<{ items?: JsonRecord[]; total_count?: number }>(
      "/v1/analytics/decommissioned-goods",
      {
        filter: { date_from: from.toISOString(), date_to: to.toISOString(), delivery_schema: "FBO" },
        page,
        page_size: 99,
        sort_by: "DATE",
        sort_dir: "ASC",
      },
      credentials,
    );
    const items = response.items ?? [];
    for (const item of items) {
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
    }
    await progress(`Списания Ozon: страница ${page}, обработано ${imported}`);
    if (!items.length || items.length < 99 || imported >= (response.total_count ?? 0)) break;
    page += 1;
    await sleep(250);
  }
  return imported;
}

export async function syncOzonData(jobId: string) {
  const settings = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  const settingsRow = settings[0];
  if (!settingsRow?.ozonClientId || !settingsRow.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
  const credentials: OzonCredentials = { clientId: settingsRow.ozonClientId, apiKey: decryptSecret(settingsRow.ozonApiKeyEncrypted) };
  const now = new Date();
  const from = settingsRow.lastSyncAt ? addDays(settingsRow.lastSyncAt, -45) : addDays(now, -365);
  const financeFrom = settingsRow.lastSyncAt ? addDays(settingsRow.lastSyncAt, -45) : new Date("2022-01-01T00:00:00Z");
  const errors: string[] = [];
  const summary: JsonRecord = {};
  const progress = async (label: string) => {
    await db.update(syncJobs).set({ summary: { ...summary, progress: label }, heartbeatAt: new Date() }).where(eq(syncJobs.id, jobId));
  };
  const run = async (label: string, task: () => Promise<unknown>) => {
    try {
      summary[label] = await task();
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      summary[label] = "ошибка";
    }
  };

  await run("orders", () => importPostings(credentials, from, now, progress));
  await run("returns", () => importReturns(credentials, from, now, progress));
  await run("buyouts", () => importBuyoutReports(credentials, financeFrom, now, progress));
  await run("accruals", () => importDailyAccruals(credentials, financeFrom, now, progress));
  await run("writeoffs", () => importWriteoffs(credentials, financeFrom, now, progress));
  if (!errors.length) await db.update(appSettings).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(appSettings.id, 1));
  if (errors.length) summary.warnings = errors;
  return summary;
}

export async function claimNextJob() {
  const connection = await db.execute(sql`UPDATE sync_jobs SET status = 'running', started_at = now(), heartbeat_at = now() WHERE id = (SELECT id FROM sync_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`);
  const row = connection.rows[0] as { id?: string } | undefined;
  return row?.id ?? null;
}
