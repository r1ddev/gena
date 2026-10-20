import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, externalItems, financeAccruals, postingItems, postings, products, returns, syncJobs } from "@/db/schema";
import { getOrderReturnStatesByPosting } from "@/domain/order-return-state";
import { financePostingSaleSkus } from "@/ozon/finance";
import { assertLocalMutation, errorResponse, handleLocalGet } from "../_lib/http";

const statusLabels: Record<string, string> = {
  delivered: "Доставлен",
  cancelled: "Отменён",
  canceled: "Отменён",
  delivering: "Доставляется",
  awaiting_deliver: "Ожидает доставки",
  awaiting_packaging: "Ожидает сборки",
};

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const params = new URL(request.url).searchParams;
    const requestedPage = Number(params.get("page"));
    const requestedPageSize = Number(params.get("pageSize"));
    const requestedPageNumber = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, 100) : 50;
    const query = (params.get("q") ?? "").trim().slice(0, 120);
    const pattern = `%${query}%`;
    const itemMatches = query ? exists(db.select({ id: postingItems.id }).from(postingItems).where(and(
      eq(postingItems.postingId, postings.id),
      or(ilike(postingItems.title, pattern), ilike(postingItems.offerId, pattern), ilike(postingItems.ozonSku, pattern),
        exists(db.select({ id: products.id }).from(products).where(and(eq(products.id, postingItems.productId), ilike(products.sku, pattern)))),
      ),
    ))) : undefined;
    const where = query ? or(
      ilike(postings.externalId, pattern),
      ilike(postings.orderNumber, pattern),
      ilike(postings.status, pattern),
      sql`${postings.orderDate}::text ILIKE ${pattern}`,
      sql`${postings.deliveredAt}::text ILIKE ${pattern}`,
      itemMatches,
    ) : undefined;
    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(postings).where(where);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPageNumber, totalPages);
    const pageRows = await db.select().from(postings).where(where)
      .orderBy(sql`${postings.orderDate} DESC NULLS LAST`, desc(postings.externalId))
      .limit(pageSize).offset((page - 1) * pageSize);
    const pagination = { page, pageSize, total, totalPages };
    if (!pageRows.length) return { items: [], pagination };

    const postingIds = pageRows.map((posting) => posting.id);
    const externalIds = pageRows.map((posting) => posting.externalId);
    const [itemRows, accruals, returnRows] = await Promise.all([
      db.select({ item: postingItems, productSku: products.sku })
        .from(postingItems)
        .leftJoin(products, eq(postingItems.productId, products.id))
        .where(inArray(postingItems.postingId, postingIds)),
      db.select().from(financeAccruals).where(inArray(financeAccruals.postingNumber, externalIds)),
      db.select().from(returns).where(inArray(returns.postingNumber, externalIds)),
    ]);
    const externalKeys = [...new Set(itemRows.map(({ item }) => item.externalKey))];
    const externalRows = externalKeys.length
      ? await db.select({ externalKey: externalItems.externalKey, disposition: externalItems.disposition }).from(externalItems).where(inArray(externalItems.externalKey, externalKeys))
      : [];
    const dispositionByKey = new Map(externalRows.map((row) => [row.externalKey, row.disposition]));
    const itemsByPosting = new Map<string, typeof itemRows>();
    for (const row of itemRows) itemsByPosting.set(row.item.postingId, [...(itemsByPosting.get(row.item.postingId) ?? []), row]);
    const accrualCentsByPosting = new Map<string, number>();
    for (const row of accruals) {
      if (!row.postingNumber) continue;
      accrualCentsByPosting.set(row.postingNumber, (accrualCentsByPosting.get(row.postingNumber) ?? 0) + Math.round(Number(row.amount) * 100));
    }
    const financeSaleSkuKeys = new Set(accruals.flatMap((row) => row.postingNumber
      ? financePostingSaleSkus(row.raw).map((sku) => `${row.postingNumber}\u0000${sku}`)
      : []));
    const returnStatesByPosting = getOrderReturnStatesByPosting(pageRows, itemRows.map(({ item }) => item), returnRows);
    return {
      items: pageRows.map((posting) => {
        const items = itemsByPosting.get(posting.id) ?? [];
        const allItemsAreMarketplaceBuyouts = items.length > 0 && items.every(({ item }) => item.isMarketplaceBuyout);
        const someItemsAreMarketplaceBuyouts = items.some(({ item }) => item.isMarketplaceBuyout);
        const translatedStatus = statusLabels[posting.status.toLowerCase()] ?? posting.status;
        const status = /cancel|отмен/i.test(posting.status)
          ? translatedStatus
          : allItemsAreMarketplaceBuyouts
            ? `${translatedStatus} · Выкуп Ozon`
            : someItemsAreMarketplaceBuyouts
              ? `${translatedStatus} · Смешанный выкуп Ozon`
              : translatedStatus;
        const buyoutCents = items.reduce((total, { item }) => {
          if (item.ozonSku && financeSaleSkuKeys.has(`${posting.externalId}\u0000${item.ozonSku}`)) return total;
          return total + Math.round(Number(item.marketplaceBuyoutAmount ?? 0) * 100);
        }, 0);
        return {
          ...posting,
          status,
          returnState: returnStatesByPosting.get(posting.externalId) ?? null,
          items: items.map(({ item, productSku }) => ({
            title: item.title, sku: productSku, offerId: item.offerId, ozonSku: item.ozonSku, quantity: item.quantity, price: item.price, mapped: Boolean(item.productId), isMarketplaceBuyout: item.isMarketplaceBuyout,
          })),
          amount: ((accrualCentsByPosting.get(posting.externalId) ?? 0) + buyoutCents) / 100,
        };
      }),
      pagination,
    };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const configuredRows = await db.select().from(appSettings).limit(1);
    const configured = configuredRows[0];
    if (!configured?.ozonClientId || !configured.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
    const [job] = await db.insert(syncJobs).values({ kind: "orders", status: "queued", summary: { requestedBy: "user" } }).returning();
    return Response.json({ item: job, message: "Синхронизация поставлена в очередь." }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
