import { and, asc, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
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
    const externalIdFilter = (params.get("filter_externalId") ?? "").trim().slice(0, 120);
    const orderDateFilter = (params.get("filter_orderDate") ?? "").trim().slice(0, 40);
    const statusFilter = (params.get("filter_status") ?? "").trim().slice(0, 80);
    const articleFilter = (params.get("filter_article") ?? "").trim().slice(0, 120);
    const amountFilter = (params.get("filter_amount") ?? "").trim().slice(0, 80);
    const sortKey = params.get("sort") ?? "";
    const direction = params.get("direction") === "asc" ? "asc" : "desc";
    const pattern = `%${query}%`;
    const itemMatches = (value: string, includeTitle = false) => exists(db.select({ id: postingItems.id }).from(postingItems).where(and(
      eq(postingItems.postingId, postings.id),
      includeTitle
        ? or(ilike(postingItems.title, value), ilike(postingItems.offerId, value), ilike(postingItems.ozonSku, value),
          exists(db.select({ id: products.id }).from(products).where(and(eq(products.id, postingItems.productId), ilike(products.sku, value)))),
        )!
        : or(ilike(postingItems.offerId, value), ilike(postingItems.ozonSku, value),
        exists(db.select({ id: products.id }).from(products).where(and(eq(products.id, postingItems.productId), ilike(products.sku, value)))),
      )!,
    )));
    const conditions: SQL[] = [];
    if (query) conditions.push(or(
      ilike(postings.externalId, pattern), ilike(postings.orderNumber, pattern), ilike(postings.status, pattern),
      sql`${postings.orderDate}::text ILIKE ${pattern}`, sql`${postings.deliveredAt}::text ILIKE ${pattern}`, itemMatches(pattern, true),
    )!);
    if (externalIdFilter) {
      const filter = `%${externalIdFilter}%`;
      conditions.push(or(ilike(postings.externalId, filter), ilike(postings.orderNumber, filter))!);
    }
    if (orderDateFilter) conditions.push(sql`to_char(${postings.orderDate} AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') ILIKE ${`%${orderDateFilter}%`}`);
    if (statusFilter) {
      const normalized = statusFilter.toLocaleLowerCase("ru-RU");
      const matchingStatuses = Object.entries(statusLabels).filter(([, label]) => label.toLocaleLowerCase("ru-RU").includes(normalized)).map(([status]) => status);
      conditions.push(matchingStatuses.length ? inArray(sql`lower(${postings.status})`, matchingStatuses) : ilike(postings.status, `%${statusFilter}%`));
    }
    if (articleFilter) conditions.push(itemMatches(`%${articleFilter}%`));
    const where = conditions.length ? and(...conditions) : undefined;
    const orderBy = sortKey === "externalId"
      ? [direction === "asc"
        ? sql`CASE WHEN ${postings.externalId} ~ '^[0-9]+$' THEN ${postings.externalId}::numeric END ASC NULLS LAST`
        : sql`CASE WHEN ${postings.externalId} ~ '^[0-9]+$' THEN ${postings.externalId}::numeric END DESC NULLS LAST`,
      direction === "asc" ? asc(postings.externalId) : desc(postings.externalId), desc(postings.orderDate)]
      : sortKey === "orderDate"
        ? [direction === "asc" ? sql`${postings.orderDate} ASC NULLS LAST` : sql`${postings.orderDate} DESC NULLS LAST`, desc(postings.externalId)]
        : [sql`${postings.orderDate} DESC NULLS LAST`, desc(postings.externalId)];
    const [countRows, soldItemRows, returnQuantityRows] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(postings).where(where),
      db.select({ postingNumber: postings.externalId, item: postingItems })
        .from(postingItems)
        .innerJoin(postings, eq(postingItems.postingId, postings.id))
        .where(or(sql`lower(${postings.status}) = 'delivered'`, eq(postingItems.isMarketplaceBuyout, true))),
      db.select({ postingNumber: returns.postingNumber, externalKey: returns.externalKey, quantity: returns.quantity }).from(returns),
    ]);
    const returnQuantityByItem = new Map<string, number>();
    for (const returned of returnQuantityRows) {
      if (!returned.postingNumber) continue;
      const key = `${returned.postingNumber}\u0000${returned.externalKey}`;
      const quantity = Number(returned.quantity ?? 0);
      if (Number.isFinite(quantity)) returnQuantityByItem.set(key, (returnQuantityByItem.get(key) ?? 0) + quantity);
    }
    const soldQuantityByItem = new Map<string, number>();
    for (const sold of soldItemRows) {
      const key = `${sold.postingNumber}\u0000${sold.item.externalKey}`;
      const quantity = Number(sold.item.quantity ?? 0);
      if (Number.isFinite(quantity)) soldQuantityByItem.set(key, (soldQuantityByItem.get(key) ?? 0) + quantity);
    }
    const soldQuantity = [...soldQuantityByItem].reduce((total, [key, quantity]) =>
      total + Math.max(0, quantity - Math.min(quantity, returnQuantityByItem.get(key) ?? 0)), 0);
    const summary = { soldQuantity };
    let total = countRows[0]?.total ?? 0;
    let pageRows: (typeof postings.$inferSelect)[];
    let totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Math.min(requestedPageNumber, totalPages);
    if (amountFilter || sortKey === "amount") {
      const candidates = await db.select().from(postings).where(where).orderBy(...orderBy);
      const candidateIds = candidates.map((posting) => posting.id);
      const candidateExternalIds = candidates.map((posting) => posting.externalId);
      const [candidateItems, candidateAccruals] = await Promise.all([
        candidateIds.length
          ? db.select({ item: postingItems }).from(postingItems).where(inArray(postingItems.postingId, candidateIds))
          : Promise.resolve([]),
        candidateExternalIds.length
          ? db.select().from(financeAccruals).where(inArray(financeAccruals.postingNumber, candidateExternalIds))
          : Promise.resolve([]),
      ]);
      const saleSkusByPosting = new Map<string, Set<string>>();
      const amountCentsByPosting = new Map<string, number>();
      for (const accrual of candidateAccruals) {
        if (!accrual.postingNumber) continue;
        amountCentsByPosting.set(accrual.postingNumber, (amountCentsByPosting.get(accrual.postingNumber) ?? 0) + Math.round(Number(accrual.amount) * 100));
        const skus = financePostingSaleSkus(accrual.raw);
        if (skus.length) saleSkusByPosting.set(accrual.postingNumber, new Set([...(saleSkusByPosting.get(accrual.postingNumber) ?? []), ...skus]));
      }
      const postingNumberById = new Map(candidates.map((posting) => [posting.id, posting.externalId]));
      for (const { item } of candidateItems) {
        const postingNumber = postingNumberById.get(item.postingId);
        if (!postingNumber || (item.ozonSku && saleSkusByPosting.get(postingNumber)?.has(item.ozonSku))) continue;
        amountCentsByPosting.set(postingNumber, (amountCentsByPosting.get(postingNumber) ?? 0) + Math.round(Number(item.marketplaceBuyoutAmount ?? 0) * 100));
      }
      const amountQuery = amountFilter.toLocaleLowerCase("ru-RU").replace(/[−–]/g, "-").replace(/\s+/g, "").replace("₽", "").replace(",", ".");
      let matching = candidates.filter((posting) => {
        if (!amountQuery) return true;
        const amount = (amountCentsByPosting.get(posting.externalId) ?? 0) / 100;
        return `${amount}|${amount.toFixed(2)}`.includes(amountQuery);
      });
      if (sortKey === "amount") {
        matching = [...matching].sort((left, right) => {
          const difference = (amountCentsByPosting.get(left.externalId) ?? 0) - (amountCentsByPosting.get(right.externalId) ?? 0);
          return difference === 0 ? left.externalId.localeCompare(right.externalId, "ru-RU", { numeric: true }) : direction === "asc" ? difference : -difference;
        });
      }
      total = matching.length;
      totalPages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(requestedPageNumber, totalPages);
      pageRows = matching.slice((page - 1) * pageSize, page * pageSize);
    } else {
      totalPages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(requestedPageNumber, totalPages);
      pageRows = await db.select().from(postings).where(where).orderBy(...orderBy).limit(pageSize).offset((page - 1) * pageSize);
    }
    const pagination = { page, pageSize, total, totalPages };
    if (!pageRows.length) return { items: [], pagination, summary };

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
        const translatedStatus = statusLabels[posting.status.toLowerCase()] ?? posting.status;
        const buyoutCents = items.reduce((total, { item }) => {
          if (item.ozonSku && financeSaleSkuKeys.has(`${posting.externalId}\u0000${item.ozonSku}`)) return total;
          return total + Math.round(Number(item.marketplaceBuyoutAmount ?? 0) * 100);
        }, 0);
        return {
          ...posting,
          status: translatedStatus,
          returnState: returnStatesByPosting.get(posting.externalId) ?? null,
          items: items.map(({ item, productSku }) => ({
            title: item.title, sku: productSku, offerId: item.offerId, ozonSku: item.ozonSku, productId: item.productId, quantity: item.quantity, price: item.price, mapped: Boolean(item.productId), isMarketplaceBuyout: item.isMarketplaceBuyout,
          })),
          amount: ((accrualCentsByPosting.get(posting.externalId) ?? 0) + buyoutCents) / 100,
        };
      }),
      pagination,
      summary,
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
