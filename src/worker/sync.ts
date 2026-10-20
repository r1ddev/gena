import { and, eq, notInArray, sql } from "drizzle-orm";
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
import { postingContainsMarketplaceBuyout } from "@/ozon/finance";

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
  return `offer:${offerId || "?"}|sku:${sku || "?"}`;
}

async function resolveExternalProduct(product: ExternalProduct, raw: JsonRecord) {
  const offerId = asString(product.offer_id);
  const sku = asString(product.sku);
  const key = externalKey(offerId, sku);
  const links = await db.select().from(productLinks).where(eq(productLinks.offerId, offerId));
  const link = links.find((candidate) => candidate.ozonSku === sku) ?? links.find((candidate) => !candidate.ozonSku);
  if (link) return { externalKey: key, offerId, sku, productId: link.productId };

  const existing = await db.select().from(externalItems).where(eq(externalItems.externalKey, key)).limit(1);
  const previous = existing[0];
  const productId = previous?.disposition === "mapped" || previous?.disposition === "created" ? previous.productId : null;
  await db.insert(externalItems).values({
    externalKey: key,
    offerId,
    ozonSku: sku,
    title: asString(product.name, "Без названия"),
    disposition: previous?.disposition ?? "pending",
    productId,
    raw,
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: externalItems.externalKey,
    set: { title: asString(product.name, "Без названия"), raw, lastSeenAt: new Date() },
  });
  return { externalKey: key, offerId, sku, productId };
}

async function upsertFboPosting(posting: FboPosting) {
  const postingNumber = asString(posting.posting_number);
  if (!postingNumber) return false;
  const status = asString(posting.status, "unknown");
  const markedAsMarketplaceBuyout = postingContainsMarketplaceBuyout(posting);
  const mappedProducts = await Promise.all((posting.products ?? []).map(async (product) => ({
    product,
    mapped: await resolveExternalProduct(product, product as JsonRecord),
  })));
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(postings).where(eq(postings.externalId, postingNumber)).limit(1);
    const deliveredAt = existing?.deliveredAt ?? (status === "delivered" ? new Date() : null);
    const [saved] = await tx.insert(postings).values({
      externalId: postingNumber,
      orderNumber: asString(posting.order_number),
      status,
      orderDate: typeof posting.created_at === "string" ? new Date(posting.created_at) : null,
      deliveredAt,
      isMarketplaceBuyout: markedAsMarketplaceBuyout,
      raw: posting as JsonRecord,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: postings.externalId,
      set: {
        orderNumber: asString(posting.order_number),
        status,
        deliveredAt,
        isMarketplaceBuyout: Boolean(existing?.isMarketplaceBuyout || markedAsMarketplaceBuyout),
        raw: posting as JsonRecord,
        updatedAt: new Date(),
      },
    }).returning({ id: postings.id });
    if (!saved) throw new Error(`Не удалось обновить отправление ${postingNumber}.`);
    await tx.delete(postingItems).where(eq(postingItems.postingId, saved.id));
    if (mappedProducts.length) await tx.insert(postingItems).values(mappedProducts.map(({ product, mapped }) => ({
      postingId: saved.id,
      externalKey: mapped.externalKey,
      productId: mapped.productId,
      offerId: mapped.offerId,
      ozonSku: mapped.sku,
      title: asString(product.name, "Без названия"),
      quantity: String(Math.max(0, asNumber(product.quantity))),
      price: String(Math.max(0, moneyAmount(product.price))),
      raw: product as JsonRecord,
    })));
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
    for (const item of page) {
      const id = asString(item.id);
      if (!id) continue;
      const product = item.product ?? {};
      const offerId = asString(product.offer_id);
      const sku = asString(product.sku);
      const mapped = await resolveExternalProduct(product, item as JsonRecord);
      const destination = guessReturnDestination(item);
      const existing = await db.select().from(returns).where(eq(returns.externalId, id)).limit(1);
      const old = existing[0];
      const returnedAtValue = item.logistic?.return_date;
      const status = asString(item.visual?.status?.sys_name, asString(item.visual?.status?.display_name, "unknown"));
      const apiReceivedAt = status.toLowerCase() === "receivedbyseller"
        ? (typeof item.logistic?.final_moment === "string" ? item.logistic.final_moment : new Date().toISOString())
        : null;
      await db.insert(returns).values({
        externalId: id,
        postingNumber: asString(item.posting_number) || null,
        externalKey: mapped.externalKey,
        productId: mapped.productId,
        offerId,
        ozonSku: sku,
        quantity: String(Math.max(0, asNumber(product.quantity))),
        destination: old?.destination === "unknown" ? destination : old?.destination ?? destination,
        status,
        returnedAt: typeof returnedAtValue === "string" ? new Date(returnedAtValue) : old?.returnedAt ?? null,
        receivedBySellerAt: old?.receivedBySellerAt ?? (apiReceivedAt ? new Date(apiReceivedAt) : null),
        availableAtOzon: old?.availableAtOzon ?? null,
        raw: item as JsonRecord,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: returns.externalId,
        set: {
          postingNumber: asString(item.posting_number) || null,
          externalKey: mapped.externalKey,
          productId: mapped.productId,
          offerId,
          ozonSku: sku,
          quantity: String(Math.max(0, asNumber(product.quantity))),
          destination: old?.destination === "unknown" ? destination : old?.destination ?? destination,
          status,
          returnedAt: typeof returnedAtValue === "string" ? new Date(returnedAtValue) : old?.returnedAt ?? null,
          receivedBySellerAt: old?.receivedBySellerAt ?? (apiReceivedAt ? new Date(apiReceivedAt) : null),
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
    const seenKeys = new Set<string>();
    for (let page = 0; page < 500; page += 1) {
      const response = await ozonPost<{ accruals?: JsonRecord[]; last_id?: string }>(
        "/v1/finance/accrual/by-day",
        { date: dayText, last_id: lastId },
        credentials,
      );
      const accruals = response.accruals ?? [];
      for (const accrual of accruals) {
        const unitNumber = asString(accrual.unit_number);
        const category = asString(accrual.accrued_category, "unknown");
        const accrualId = asString(accrual.accrual_id ?? accrual.type_id);
        if (category.toUpperCase() === "POSTING" && unitNumber) {
          await db.delete(financeAccruals).where(and(eq(financeAccruals.postingNumber, unitNumber), eq(financeAccruals.accrualId, "imported")));
        }
        const itemFees = accrual.item_fees as { fees?: { sku?: unknown; fees?: { accrued?: unknown; type_id?: unknown }[] }[] } | undefined;
        const financeRows: { suffix: string; productId: string | null; amount: number; typeId: string }[] = [];
        if (category.toUpperCase() === "ITEM" && itemFees?.fees?.length) {
          for (const itemFee of itemFees.fees) {
            const sku = asString(itemFee.sku);
            const fees = itemFee.fees ?? [];
            const amount = fees.reduce((sum, fee) => sum + Math.round(moneyAmount(fee.accrued) * 100), 0) / 100;
            if (amount === 0 && fees.length === 0) continue;
            const links = sku ? await db.select().from(productLinks).where(eq(productLinks.ozonSku, sku)).limit(1) : [];
            const externalRows = sku ? await db.select().from(externalItems).where(eq(externalItems.ozonSku, sku)) : [];
            const external = externalRows.find((entry) => entry.disposition === "mapped" || entry.disposition === "created");
            const productId = links[0]?.productId ?? external?.productId ?? null;
            financeRows.push({ suffix: `sku:${sku}`, productId, amount, typeId: fees.map((fee) => asString(fee.type_id)).sort().join(",") });
          }
        } else {
          const totalAmount = accrual.total_amount as { amount?: unknown } | undefined;
          financeRows.push({ suffix: "", productId: null, amount: moneyAmount(totalAmount), typeId: "" });
        }

        for (const financeRow of financeRows) {
          const fingerprint = createHash("sha256").update(JSON.stringify(accrual)).digest("hex").slice(0, 24);
          const stableId = accrualId || fingerprint;
          const key = `${dayText}:${category}:${unitNumber}:${stableId}:${financeRow.suffix}`;
          seenKeys.add(key);
          await db.insert(financeAccruals).values({
            externalKey: key,
            accrualDate: dayText,
            postingNumber: category.toUpperCase() === "POSTING" ? unitNumber || null : null,
            productId: financeRow.productId,
            accrualId,
            accruedCategory: category,
            typeId: financeRow.typeId,
            amount: String(financeRow.amount),
            raw: accrual,
          }).onConflictDoUpdate({
            target: financeAccruals.externalKey,
            set: {
              postingNumber: category.toUpperCase() === "POSTING" ? unitNumber || null : null,
              productId: financeRow.productId,
              amount: String(financeRow.amount),
              accruedCategory: category,
              typeId: financeRow.typeId,
              raw: accrual,
            },
          });
          total += 1;
        }
      }
      lastId = response.last_id ?? "";
      if (!lastId || !accruals.length) break;
      await sleep(100);
    }
    const oldRows = await db.select({ externalKey: financeAccruals.externalKey }).from(financeAccruals).where(eq(financeAccruals.accrualDate, dayText));
    const obsoleteKeys = oldRows.map((row) => row.externalKey).filter((key) => !seenKeys.has(key));
    if (seenKeys.size && obsoleteKeys.length) await db.delete(financeAccruals).where(and(eq(financeAccruals.accrualDate, dayText), notInArray(financeAccruals.externalKey, [...seenKeys])));
    if (!seenKeys.size) await db.delete(financeAccruals).where(eq(financeAccruals.accrualDate, dayText));
    days += 1;
    if (days % 10 === 0 || dayText === dateOnly(to)) await progress(`Начисления Ozon: ${days} дней, ${total} строк; до ${dayText}`);
    await sleep(200);
  }
  return { days, accruals: total };
}

async function importBuyoutReports(credentials: OzonCredentials, from: Date, to: Date, progress: (label: string) => Promise<void>) {
  let reports = 0;
  let productsFound = 0;
  for (let current = new Date(from); current <= to;) {
    const rangeEnd = new Date(Math.min(addDays(current, 30).getTime(), to.getTime()));
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
      const key = externalKey(offerId, sku);
      const posting = await db.select().from(postings).where(eq(postings.externalId, postingNumber)).limit(1);
      if (posting[0]) {
        await db.update(postings).set({
          isMarketplaceBuyout: true,
          marketplaceBuyoutAt: sql`COALESCE(${postings.marketplaceBuyoutAt}, ${new Date()})`,
          updatedAt: new Date(),
        }).where(eq(postings.externalId, postingNumber));
      }
      if (!link && offerId) await resolveExternalProduct(product as ExternalProduct, product);
      productsFound += 1;
      void key;
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
      const productMatch = await db.select().from(productLinks).where(eq(productLinks.ozonSku, sku)).limit(1);
      const productId = productMatch[0]?.productId ?? (await resolveExternalProduct(candidate, item)).productId;
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
