import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, externalItems, financeAccruals, postingItems, postings, returns, syncJobs } from "@/db/schema";
import { isPostingRecognized } from "@/domain/accounting";
import { getOrderReturnStatesByPosting } from "@/domain/order-return-state";
import { assertLocalMutation, errorResponse, handleLocalGet } from "../_lib/http";

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
      or(ilike(postingItems.title, pattern), ilike(postingItems.offerId, pattern), ilike(postingItems.ozonSku, pattern)),
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
      db.select().from(postingItems).where(inArray(postingItems.postingId, postingIds)),
      db.select().from(financeAccruals).where(inArray(financeAccruals.postingNumber, externalIds)),
      db.select().from(returns).where(inArray(returns.postingNumber, externalIds)),
    ]);
    const externalKeys = [...new Set(itemRows.map((item) => item.externalKey))];
    const externalRows = externalKeys.length
      ? await db.select({ externalKey: externalItems.externalKey, disposition: externalItems.disposition }).from(externalItems).where(inArray(externalItems.externalKey, externalKeys))
      : [];
    const dispositionByKey = new Map(externalRows.map((row) => [row.externalKey, row.disposition]));
    const itemsByPosting = new Map<string, typeof itemRows>();
    for (const item of itemRows) itemsByPosting.set(item.postingId, [...(itemsByPosting.get(item.postingId) ?? []), item]);
    const accrualsByPosting = new Map<string, number>();
    for (const row of accruals) if (row.postingNumber) accrualsByPosting.set(row.postingNumber, (accrualsByPosting.get(row.postingNumber) ?? 0) + Number(row.amount));
    const returnStatesByPosting = getOrderReturnStatesByPosting(pageRows, itemRows, returnRows);
    const now = new Date();
    return {
      items: pageRows.map((posting) => {
        const items = itemsByPosting.get(posting.id) ?? [];
        const recognized = isPostingRecognized({
          id: posting.id,
          status: posting.status,
          deliveredAt: posting.deliveredAt?.toISOString() ?? null,
          marketplaceBuyoutAt: posting.marketplaceBuyoutAt?.toISOString() ?? null,
          isMarketplaceBuyout: posting.isMarketplaceBuyout,
        }, items.map((item) => ({
          postingId: item.postingId,
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          movementEnabled: item.movementEnabled,
          isMarketplaceBuyout: item.isMarketplaceBuyout,
          marketplaceBuyoutAt: item.marketplaceBuyoutAt?.toISOString() ?? null,
          ignored: dispositionByKey.get(item.externalKey) === "ignored",
        })), now);
        return {
          ...posting,
          returnState: returnStatesByPosting.get(posting.externalId) ?? null,
          items: items.map((item) => ({
            title: item.title, offerId: item.offerId, ozonSku: item.ozonSku, quantity: item.quantity, price: item.price, mapped: Boolean(item.productId), isMarketplaceBuyout: item.isMarketplaceBuyout,
          })),
          amount: accrualsByPosting.get(posting.externalId) ?? 0,
          recognized,
          phase: (() => {
            if (items.length && items.every((item) => item.isMarketplaceBuyout)) return "Выкуп Ozon";
            if (items.some((item) => item.isMarketplaceBuyout)) return "Смешанная продажа";
            return recognized ? "Учтён" : posting.deliveredAt ? "Предварительно" : "Ожидает доставки";
          })(),
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
