import { and, asc, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, externalItems, financeAccruals, postingItems, postings, productLinks, products, returns, syncJobs } from "@/db/schema";
import { getAccountingSnapshot, persistAddedCostRateSnapshots } from "@/domain/accounting-repository";
import { calculateFinalPostingProfits } from "@/domain/order-profit";
import { currentOrderStatus, getOrderReturnStatesByPosting, hasRestockedReturn } from "@/domain/order-return-state";
import { buildFinanceOrderSkuPostingMap, financePostingSaleSkus, financeReturnLogisticsCents, resolveFinanceAccrualPostingNumber } from "@/ozon/finance";
import { isOzonWriteOffStatus } from "@/ozon/return-status";
import { buildCatalogProductWhitelist, isFinanceRowOutsideCatalog, resolveCatalogProductId, type CatalogProductWhitelist } from "@/ozon/catalog-whitelist";
import { errorResponse, handleLocalGet, requireAuthenticatedMutation } from "../_lib/http";

async function loadCatalog(userId: string) {
  const [catalog, links, externalRows] = await Promise.all([
    db.select({ id: products.id, sku: products.sku, title: products.title, archived: products.archived }).from(products).where(eq(products.userId, userId)),
    db.select({ productId: productLinks.productId, offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks).where(eq(productLinks.userId, userId)),
    db.select({ externalKey: externalItems.externalKey, offerId: externalItems.offerId, ozonSku: externalItems.ozonSku, productId: externalItems.productId }).from(externalItems).where(eq(externalItems.userId, userId)),
  ]);
  return {
    whitelist: buildCatalogProductWhitelist(catalog, links, externalRows),
    skuByProductId: new Map(catalog.filter((product) => !product.archived).map((product) => [product.id, product.sku])),
    titleByProductId: new Map(catalog.filter((product) => !product.archived).map((product) => [product.id, product.title])),
  };
}

function catalogPostingItems<T extends { postingId: string; productId?: string | null; offerId?: string | null; ozonSku?: string | null; externalKey?: string | null }>(
  items: T[],
  whitelist: CatalogProductWhitelist,
) {
  return items.flatMap((item) => {
    const productId = resolveCatalogProductId(whitelist, item);
    return productId ? [{ ...item, productId }] : [];
  });
}

function emptyOrderSummary() {
  return {
    soldQuantity: 0,
    returnQuantity: 0,
    returnCount: 0,
    purchaseQuantity: 0,
    successfulPurchasePercent: null,
    successfulDeliveryQuantity: 0,
    attemptedDeliveryQuantity: 0,
    profitTotal: 0,
    profitPostingCount: 0,
    profitIncompleteCount: 0,
    filteredPostingCount: 0,
  };
}

function addedCostExplanation(
  breakdown: Record<string, unknown> | undefined,
  status: string,
  hasSaleEvent: boolean,
) {
  const normalizedStatus = status.trim().toLocaleLowerCase("ru-RU");
  if (!breakdown) {
    if (/cancel|отмен|declin|reject/i.test(normalizedStatus)) return "Отправление отменено, процент не распределялся.";
    if (hasSaleEvent) return "На дату продажи не было закупочной стоимости остатков для расчёта процента.";
    return "Процент появится после доставки или выкупа.";
  }
  const keys = ["sharedCostsBefore", "purchaseValueBefore", "ratePercent", "purchaseValueSold", "allocatedSharedCosts", "sharedCostsAfter"];
  const values = keys.map((key) => Number(breakdown[key]));
  if (values.some((value) => !Number.isFinite(value))) return "Не удалось получить составляющие расчёта.";
  const [poolBefore, purchaseBefore, rate, purchaseSold, allocated, poolAfter] = values;
  const money = (value: number) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const percent = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 8 }).format(rate);
  const lines = [
    `Перед продажей: ${money(poolBefore)} ₽ расходов ÷ ${money(purchaseBefore)} ₽ закупочной стоимости остатков × 100 = ${percent}%.`,
    `На отправление: ${money(purchaseSold)} ₽ × ${percent}% = ${money(allocated)} ₽. В пуле осталось ${money(poolAfter)} ₽.`,
  ];
  if (breakdown.fullyReturned === true) lines.push("После полного возврата процент снят, доля расходов вернулась в пул.");
  return lines.join("\n");
}

async function orderFilterOptions(userId: string) {
  const [allPostingRows, catalog] = await Promise.all([
    db.select().from(postings).where(eq(postings.userId, userId)),
    loadCatalog(userId),
  ]);
  const { whitelist, skuByProductId } = catalog;
  const allPostingItemRows = allPostingRows.length
    ? await db.select({ item: postingItems })
      .from(postingItems)
      .where(and(eq(postingItems.userId, userId), inArray(postingItems.postingId, allPostingRows.map((posting) => posting.id))))
    : [];
  const allPostingItems = catalogPostingItems(allPostingItemRows.map(({ item }) => item), whitelist);
  const postingIdsWithCatalogItems = new Set(allPostingItems.map((item) => item.postingId));
  const allPostings = allPostingRows.filter((posting) => postingIdsWithCatalogItems.has(posting.id));
  if (!allPostings.length) return { externalId: [], status: [], article: [], amount: [], profit: [] };

  const postingNumbers = allPostings.map((posting) => posting.externalId);
  const [accrualRows, financePostingByOrderSku, returnRows, accounting] = await Promise.all([
    financeAccrualsForPostings(allPostings, userId),
    financePostingMapForOrders(allPostings.map((posting) => posting.orderNumber), userId),
    db.select().from(returns).where(and(eq(returns.userId, userId), inArray(returns.postingNumber, postingNumbers))),
    getAccountingSnapshot(userId),
  ]);
  const itemRows = allPostingItems.filter((item) => postingIdsWithCatalogItems.has(item.postingId));
  const filteredAccrualRows = accrualRows.filter((row) => {
    const postingNumber = resolveFinanceAccrualPostingNumber(row, financePostingByOrderSku);
    return Boolean(postingNumber && postingNumbers.includes(postingNumber));
  });
  const filteredReturnRows = returnRows.flatMap((row) => {
    const rawProduct = row.raw.product && typeof row.raw.product === "object" && !Array.isArray(row.raw.product)
      ? row.raw.product as Record<string, unknown>
      : {};
    const productId = resolveCatalogProductId(whitelist, {
      productId: row.productId,
      offerId: row.offerId || String(rawProduct.offer_id ?? ""),
      ozonSku: row.ozonSku || String(rawProduct.sku ?? ""),
      externalKey: row.externalKey,
    });
    return productId && (!row.postingNumber || postingNumbers.includes(row.postingNumber)) ? [{ ...row, productId }] : [];
  });

  const returnStatesByPosting = getOrderReturnStatesByPosting(
    allPostings.map(({ id, externalId }) => ({ id, externalId })),
    filteredReturnRows,
  );
  const statusOptions = new Set<string>();
  for (const posting of allPostings) {
    const returnState = returnStatesByPosting.get(posting.externalId);
    statusOptions.add(currentOrderStatus(posting.status, returnState));
    if (returnState) statusOptions.add(returnState);
  }

  const articleOptions = new Set<string>();
  const postingNumberById = new Map(allPostings.map((posting) => [posting.id, posting.externalId]));
  const saleSkusByPosting = new Map<string, Set<string>>();
  const amountCentsByPosting = new Map(allPostings.map((posting) => [posting.externalId, 0]));
  for (const accrual of filteredAccrualRows) {
    const postingNumber = resolveFinanceAccrualPostingNumber(accrual, financePostingByOrderSku);
    if (!postingNumber) continue;
    amountCentsByPosting.set(postingNumber, (amountCentsByPosting.get(postingNumber) ?? 0) + Math.round(Number(accrual.amount) * 100));
    const skus = financePostingSaleSkus(accrual.raw);
    if (skus.length) saleSkusByPosting.set(postingNumber, new Set([...(saleSkusByPosting.get(postingNumber) ?? []), ...skus]));
  }
  for (const item of itemRows) {
    const postingNumber = postingNumberById.get(item.postingId);
    if (!postingNumber) continue;
    const article = skuByProductId.get(item.productId) || item.offerId || item.ozonSku;
    if (article) articleOptions.add(article);
    if (item.ozonSku && saleSkusByPosting.get(postingNumber)?.has(item.ozonSku)) continue;
    amountCentsByPosting.set(postingNumber, (amountCentsByPosting.get(postingNumber) ?? 0) + Math.round(Number(item.marketplaceBuyoutAmount ?? 0) * 100));
  }
  const unitCostByProduct = new Map(accounting.products.map((product) => [product.id, product.landedUnitCostExact ?? product.landedUnitCost ?? null]));
  const profitByPosting = calculateFinalPostingProfits({
    postings: allPostings,
    items: itemRows.map((item) => ({
      postingId: item.postingId,
      productId: item.productId,
      quantity: item.quantity,
      movementEnabled: item.movementEnabled,
    })),
    returns: filteredReturnRows.flatMap((returned) => returned.postingNumber && returned.productId && hasRestockedReturn(returned)
      ? [{ postingNumber: returned.postingNumber, productId: returned.productId, quantity: returned.quantity }]
      : []),
    writeoffs: filteredReturnRows.flatMap((returned) => returned.postingNumber && returned.productId && returned.writtenOffAt && !isOzonWriteOffStatus(returned.status, returned.raw)
      ? [{ postingNumber: returned.postingNumber, productId: returned.productId, quantity: returned.quantity }]
      : []),
    amountCentsByPosting,
    unitCostByProduct,
  });

  return {
    externalId: [...new Set(allPostings.map((posting) => posting.externalId).filter(Boolean))],
    status: [...statusOptions],
    article: [...articleOptions],
    amount: [...new Set([...amountCentsByPosting.values()].map((cents) => (cents / 100).toFixed(2)))],
    profit: [...new Set([...profitByPosting.values()].flatMap(({ profitCents }) => profitCents === null ? [] : [(profitCents / 100).toFixed(2)]))],
  };
}

function financeAccrualsForPostings(rows: { externalId: string; orderNumber: string }[], userId: string) {
  const unitNumbers = [...new Set(rows.map((posting) => posting.orderNumber).filter(Boolean))];
  const numbers = [...new Set(rows.flatMap((posting) => [posting.externalId, posting.orderNumber]).filter(Boolean))];
  const conditions = [
    ...(numbers.length ? [inArray(financeAccruals.postingNumber, numbers)] : []),
    ...(unitNumbers.length ? [inArray(sql<string>`${financeAccruals.raw}->>'unit_number'`, unitNumbers)] : []),
  ];
  return conditions.length ? db.select().from(financeAccruals).where(and(eq(financeAccruals.userId, userId), or(...conditions))) : Promise.resolve([]);
}

async function financePostingMapForOrders(orderNumbers: string[], userId: string) {
  const uniqueOrderNumbers = [...new Set(orderNumbers.filter(Boolean))];
  if (!uniqueOrderNumbers.length) return new Map<string, string>();
  const relatedPostings = await db.select({ id: postings.id, externalId: postings.externalId, orderNumber: postings.orderNumber })
    .from(postings).where(and(eq(postings.userId, userId), inArray(postings.orderNumber, uniqueOrderNumbers)));
  if (!relatedPostings.length) return new Map<string, string>();
  const items = await db.select({ postingId: postingItems.postingId, ozonSku: postingItems.ozonSku })
    .from(postingItems).where(and(eq(postingItems.userId, userId), inArray(postingItems.postingId, relatedPostings.map((posting) => posting.id))));
  return buildFinanceOrderSkuPostingMap(relatedPostings, items);
}

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const params = new URL(request.url).searchParams;
    if (params.get("filterOptions") === "1") return { filterOptions: await orderFilterOptions(userId) };
    const catalog = await loadCatalog(userId);
    const { whitelist, skuByProductId, titleByProductId } = catalog;
    const requestedPage = Number(params.get("page"));
    const requestedPageSize = Number(params.get("pageSize"));
    const requestedPageNumber = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, 100) : 50;
    const query = (params.get("q") ?? "").trim().slice(0, 120);
    const externalIdFilter = (params.get("filter_externalId") ?? "").trim().slice(0, 120);
    const orderDateFilter = (params.get("filter_orderDate") ?? "").trim().slice(0, 120);
    const statusFilter = (params.get("filter_status") ?? "").trim().slice(0, 80);
    const articleFilter = (params.get("filter_article") ?? "").trim().slice(0, 120);
    const amountFilter = (params.get("filter_amount") ?? "").trim().slice(0, 80);
    const profitFilter = (params.get("filter_profit") ?? "").trim().slice(0, 80);
    const sortKey = params.get("sort") ?? "";
    const direction = params.get("direction") === "asc" ? "asc" : "desc";
    const pattern = `%${query}%`;
    const catalogItemConditions: SQL[] = [
      ...(whitelist.productIds.size ? [inArray(postingItems.productId, [...whitelist.productIds])] : []),
      ...(whitelist.productIdByOfferId.size ? [inArray(postingItems.offerId, [...whitelist.productIdByOfferId.keys()])] : []),
      ...(whitelist.productIdByOzonSku.size ? [inArray(postingItems.ozonSku, [...whitelist.productIdByOzonSku.keys()])] : []),
    ];
    if (!catalogItemConditions.length) return { items: [], pagination: { page: requestedPageNumber, pageSize, total: 0, totalPages: 1 }, summary: emptyOrderSummary() };
    const catalogItemCondition = or(...catalogItemConditions)!;
    const itemMatches = (value: string, includeTitle = false) => exists(db.select({ id: postingItems.id }).from(postingItems).where(and(
      eq(postingItems.postingId, postings.id),
      eq(postingItems.userId, userId),
      catalogItemCondition,
      includeTitle
        ? or(ilike(postingItems.title, value), ilike(postingItems.offerId, value), ilike(postingItems.ozonSku, value),
          exists(db.select({ id: products.id }).from(products).where(and(eq(products.id, postingItems.productId), eq(products.userId, userId), ilike(products.sku, value)))),
        )!
        : or(ilike(postingItems.offerId, value), ilike(postingItems.ozonSku, value),
        exists(db.select({ id: products.id }).from(products).where(and(eq(products.id, postingItems.productId), eq(products.userId, userId), ilike(products.sku, value)))),
      )!,
    )));
    const conditions: SQL[] = [exists(db.select({ id: postingItems.id }).from(postingItems).where(and(
      eq(postingItems.postingId, postings.id),
      eq(postingItems.userId, userId),
      catalogItemCondition,
    ))), eq(postings.userId, userId)];
    if (query) conditions.push(or(
      ilike(postings.externalId, pattern), ilike(postings.orderNumber, pattern), ilike(postings.status, pattern),
      sql`${postings.orderDate}::text ILIKE ${pattern}`, sql`${postings.deliveredAt}::text ILIKE ${pattern}`, itemMatches(pattern, true),
    )!);
    if (externalIdFilter) {
      const filter = `%${externalIdFilter}%`;
      conditions.push(or(ilike(postings.externalId, filter), ilike(postings.orderNumber, filter))!);
    }
    if (orderDateFilter) {
      let dateRange = { from: "", to: "" };
      try {
        const parsed: unknown = JSON.parse(orderDateFilter);
        if (parsed && typeof parsed === "object" && "from" in parsed && "to" in parsed) {
          const range = parsed as { from?: unknown; to?: unknown };
          dateRange = { from: typeof range.from === "string" ? range.from : "", to: typeof range.to === "string" ? range.to : "" };
        } else dateRange = { from: orderDateFilter, to: orderDateFilter };
      } catch {
        dateRange = { from: orderDateFilter, to: orderDateFilter };
      }
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
      if (validDate(dateRange.from)) conditions.push(sql`to_char(${postings.orderDate} AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') >= ${dateRange.from}`);
      if (validDate(dateRange.to)) conditions.push(sql`to_char(${postings.orderDate} AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') <= ${dateRange.to}`);
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
    const candidates = await db.select().from(postings).where(where).orderBy(...orderBy);
    const candidateIds = candidates.map((posting) => posting.id);
    const candidateExternalIds = candidates.map((posting) => posting.externalId);
    const [candidateItemRows, candidateAccruals, candidateFinancePostingByOrderSku, candidateReturns, accounting] = await Promise.all([
      candidateIds.length
        ? db.select({ item: postingItems }).from(postingItems).where(and(eq(postingItems.userId, userId), inArray(postingItems.postingId, candidateIds)))
        : Promise.resolve([]),
      financeAccrualsForPostings(candidates, userId),
      financePostingMapForOrders(candidates.map((posting) => posting.orderNumber), userId),
      candidateExternalIds.length
        ? db.select().from(returns).where(and(eq(returns.userId, userId), inArray(returns.postingNumber, candidateExternalIds)))
        : Promise.resolve([]),
    getAccountingSnapshot(userId, new Date(), true),
    ]);
    await persistAddedCostRateSnapshots(userId, accounting);
    const addedCostRateByPostingId = accounting.addedCostRateByPostingId ?? {};
    const addedCostBreakdownByPostingId = accounting.addedCostBreakdownByPostingId ?? {};
    const candidateItems = catalogPostingItems(candidateItemRows.map(({ item }) => item), whitelist).map((item) => ({ item }));
    const candidatePostingIds = new Set(candidateItems.map(({ item }) => item.postingId));
    const visibleCandidates = candidates.filter((posting) => candidatePostingIds.has(posting.id));
    const visibleCandidateNumbers = new Set(visibleCandidates.map((posting) => posting.externalId));
    const visibleCandidateAccruals = candidateAccruals.filter((row) => {
      const postingNumber = resolveFinanceAccrualPostingNumber(row, candidateFinancePostingByOrderSku);
      return !postingNumber || visibleCandidateNumbers.has(postingNumber);
    });
    const visibleCandidateReturns = candidateReturns.flatMap((row) => {
      const rawProduct = row.raw.product && typeof row.raw.product === "object" && !Array.isArray(row.raw.product)
        ? row.raw.product as Record<string, unknown>
        : {};
      const productId = resolveCatalogProductId(whitelist, {
        productId: row.productId,
        offerId: row.offerId || String(rawProduct.offer_id ?? ""),
        ozonSku: row.ozonSku || String(rawProduct.sku ?? ""),
        externalKey: row.externalKey,
      });
      return productId && (!row.postingNumber || visibleCandidateNumbers.has(row.postingNumber)) ? [{ ...row, productId }] : [];
    });
    const candidateReturnStatesByPosting = getOrderReturnStatesByPosting(
      visibleCandidates.map(({ id, externalId }) => ({ id, externalId })),
      visibleCandidateReturns,
    );
    const saleSkusByPosting = new Map<string, Set<string>>();
    const amountCentsByPosting = new Map(visibleCandidates.map((posting) => [posting.externalId, 0]));
    for (const accrual of visibleCandidateAccruals) {
      const postingNumber = resolveFinanceAccrualPostingNumber(accrual, candidateFinancePostingByOrderSku);
      if (!postingNumber) continue;
      amountCentsByPosting.set(postingNumber, (amountCentsByPosting.get(postingNumber) ?? 0) + Math.round(Number(accrual.amount) * 100));
      const skus = financePostingSaleSkus(accrual.raw);
      if (skus.length) saleSkusByPosting.set(postingNumber, new Set([...(saleSkusByPosting.get(postingNumber) ?? []), ...skus]));
    }
    const postingNumberById = new Map(visibleCandidates.map((posting) => [posting.id, posting.externalId]));
    for (const { item } of candidateItems) {
      const postingNumber = postingNumberById.get(item.postingId);
      if (!postingNumber || (item.ozonSku && saleSkusByPosting.get(postingNumber)?.has(item.ozonSku))) continue;
      amountCentsByPosting.set(postingNumber, (amountCentsByPosting.get(postingNumber) ?? 0) + Math.round(Number(item.marketplaceBuyoutAmount ?? 0) * 100));
    }
    const unitCostByProduct = new Map(accounting.products.map((product) => [product.id, product.landedUnitCostExact ?? product.landedUnitCost ?? null]));
    const profitByPosting = calculateFinalPostingProfits({
      postings: visibleCandidates,
      items: candidateItems.map(({ item }) => ({
        postingId: item.postingId,
        productId: item.productId,
        quantity: item.quantity,
        movementEnabled: item.movementEnabled,
      })),
      returns: visibleCandidateReturns.flatMap((returned) => returned.postingNumber && returned.productId && returned.destination === "seller" && returned.receivedBySellerAt && !returned.writtenOffAt && !isOzonWriteOffStatus(returned.status, returned.raw)
        ? [{ postingNumber: returned.postingNumber, productId: returned.productId, quantity: returned.quantity }]
        : []),
      writeoffs: visibleCandidateReturns.flatMap((returned) => returned.postingNumber && returned.productId && returned.writtenOffAt && !isOzonWriteOffStatus(returned.status, returned.raw)
        ? [{ postingNumber: returned.postingNumber, productId: returned.productId, quantity: returned.quantity }]
        : []),
      amountCentsByPosting,
      unitCostByProduct,
    });

    const amountQuery = amountFilter.toLocaleLowerCase("ru-RU").replace(/[−–]/g, "-").replace(/\s+/g, "").replace("₽", "").replace(",", ".");
    const profitQuery = profitFilter.toLocaleLowerCase("ru-RU").replace(/[−–]/g, "-").replace(/\s+/g, "").replace("₽", "").replace(",", ".");
    let matching = visibleCandidates.filter((posting) => {
      const amount = (amountCentsByPosting.get(posting.externalId) ?? 0) / 100;
      if (amountQuery && !`${amount}|${amount.toFixed(2)}`.includes(amountQuery)) return false;
      if (profitQuery) {
        const profitCents = profitByPosting.get(posting.externalId)?.profitCents;
        if (profitCents === null || profitCents === undefined) return false;
        const profit = profitCents / 100;
        if (!`${profit}|${profit.toFixed(2)}`.includes(profitQuery)) return false;
      }
      return true;
    });
    if (statusFilter) {
      const normalizedStatus = statusFilter.toLocaleLowerCase("ru-RU");
      matching = matching.filter((posting) => {
        const returnState = candidateReturnStatesByPosting.get(posting.externalId);
        const filterableStatus = `${currentOrderStatus(posting.status, returnState)} ${returnState ?? ""}`.toLocaleLowerCase("ru-RU");
        return filterableStatus.includes(normalizedStatus);
      });
    }
    if (sortKey === "amount") {
      matching = [...matching].sort((left, right) => {
        const difference = (amountCentsByPosting.get(left.externalId) ?? 0) - (amountCentsByPosting.get(right.externalId) ?? 0);
        return difference === 0 ? left.externalId.localeCompare(right.externalId, "ru-RU", { numeric: true }) : direction === "asc" ? difference : -difference;
      });
    }
    if (sortKey === "profit") {
      matching = [...matching].sort((left, right) => {
        const leftProfit = profitByPosting.get(left.externalId)?.profitCents;
        const rightProfit = profitByPosting.get(right.externalId)?.profitCents;
        if (leftProfit === null || leftProfit === undefined) return rightProfit === null || rightProfit === undefined ? 0 : 1;
        if (rightProfit === null || rightProfit === undefined) return -1;
        const difference = leftProfit - rightProfit;
        return difference === 0 ? left.externalId.localeCompare(right.externalId, "ru-RU", { numeric: true }) : direction === "asc" ? difference : -difference;
      });
    }

    const matchedPostingIds = new Set(matching.map((posting) => posting.id));
    const matchedPostingNumbers = new Set(matching.map((posting) => posting.externalId));
    const postingById = new Map(matching.map((posting) => [posting.id, posting]));
    let successfulDeliveryQuantity = 0;
    let attemptedDeliveryQuantity = 0;
    const deliveredQuantityByItem = new Map<string, number>();
    for (const { item } of candidateItems) {
      if (!matchedPostingIds.has(item.postingId)) continue;
      const posting = postingById.get(item.postingId);
      const quantity = Number(item.quantity ?? 0);
      if (!posting || !Number.isFinite(quantity) || quantity <= 0) continue;
      const status = posting.status.toLocaleLowerCase("en-US");
      const cancelled = /cancel|отмен|declin|reject/i.test(status);
      const delivered = !cancelled && (status === "delivered" || item.isMarketplaceBuyout);
      if (delivered) {
        successfulDeliveryQuantity += quantity;
        attemptedDeliveryQuantity += quantity;
        if (item.productId) {
          const key = `${posting.externalId}\u0000${item.productId}`;
          deliveredQuantityByItem.set(key, (deliveredQuantityByItem.get(key) ?? 0) + quantity);
        }
      }
      if (cancelled) attemptedDeliveryQuantity += quantity;
    }
    const matchedItemProducts = new Set(candidateItems.flatMap(({ item }) =>
      item.productId ? [`${item.postingId}\u0000${item.productId}`] : [],
    ));
    const postingIdByNumber = new Map(matching.map((posting) => [posting.externalId, posting.id]));
    const returnQuantityByItem = new Map<string, number>();
    let returnQuantity = 0;
    const matchedReturns = visibleCandidateReturns.filter((returned) => {
      if (!returned.postingNumber || !matchedPostingNumbers.has(returned.postingNumber) || !returned.productId || isOzonWriteOffStatus(returned.status, returned.raw)) return false;
      const postingId = postingIdByNumber.get(returned.postingNumber);
      if (!postingId || !matchedItemProducts.has(`${postingId}\u0000${returned.productId}`)) return false;
      const key = `${returned.postingNumber}\u0000${returned.productId}`;
      const quantity = Number(returned.quantity ?? 0);
      if (Number.isFinite(quantity) && quantity > 0) {
        returnQuantity += quantity;
        returnQuantityByItem.set(key, (returnQuantityByItem.get(key) ?? 0) + quantity);
      }
      return true;
    });
    const returnedFromDeliveredQuantity = [...returnQuantityByItem].reduce((total, [key, quantity]) =>
      total + Math.min(quantity, deliveredQuantityByItem.get(key) ?? 0), 0);
    const soldQuantity = Math.max(0, successfulDeliveryQuantity - returnedFromDeliveredQuantity);
    const purchaseQuantity = soldQuantity + returnQuantity;
    const total = matching.length;
    const summary = {
      soldQuantity,
      returnQuantity,
      returnCount: matchedReturns.length,
      purchaseQuantity,
      successfulPurchasePercent: attemptedDeliveryQuantity > 0 ? successfulDeliveryQuantity / attemptedDeliveryQuantity * 100 : null,
      successfulDeliveryQuantity,
      attemptedDeliveryQuantity,
      profitTotal: matching.reduce((sum, posting) => sum + (profitByPosting.get(posting.externalId)?.profitCents ?? 0), 0) / 100,
      profitPostingCount: matching.filter((posting) => profitByPosting.get(posting.externalId)?.profitCents !== null && profitByPosting.get(posting.externalId)?.profitCents !== undefined).length,
      profitIncompleteCount: matching.filter((posting) => profitByPosting.get(posting.externalId)?.missingCost).length,
      filteredPostingCount: total,
    };
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPageNumber, totalPages);
    const pageRows = matching.slice((page - 1) * pageSize, page * pageSize);
    const pagination = { page, pageSize, total, totalPages };
    if (!pageRows.length) return { items: [], pagination, summary };

    const postingIds = pageRows.map((posting) => posting.id);
    const externalIds = pageRows.map((posting) => posting.externalId);
    const [itemRows, accruals, returnRows, financePostingByOrderSku] = await Promise.all([
      db.select({ item: postingItems, productSku: products.sku })
        .from(postingItems)
        .leftJoin(products, and(eq(postingItems.productId, products.id), eq(products.userId, userId)))
        .where(and(eq(postingItems.userId, userId), inArray(postingItems.postingId, postingIds))),
      financeAccrualsForPostings(pageRows, userId),
      db.select().from(returns).where(and(eq(returns.userId, userId), inArray(returns.postingNumber, externalIds))),
      financePostingMapForOrders(pageRows.map((posting) => posting.orderNumber), userId),
    ]);
    const visibleItemRows = itemRows.flatMap((row) => {
      const productId = resolveCatalogProductId(whitelist, row.item);
      return productId ? [{ ...row, item: { ...row.item, productId } }] : [];
    });
    const itemsByPosting = new Map<string, typeof visibleItemRows>();
    for (const row of visibleItemRows) itemsByPosting.set(row.item.postingId, [...(itemsByPosting.get(row.item.postingId) ?? []), row]);
    const pagePostingNumbers = new Set(pageRows.map((posting) => posting.externalId));
    const visibleAccruals = accruals.filter((row) => {
      const postingNumber = resolveFinanceAccrualPostingNumber(row, financePostingByOrderSku);
      if (postingNumber) return pagePostingNumbers.has(postingNumber);
      return !isFinanceRowOutsideCatalog(whitelist, row, undefined);
    });
    const visibleReturnRows = returnRows.flatMap((row) => {
      const rawProduct = row.raw.product && typeof row.raw.product === "object" && !Array.isArray(row.raw.product)
        ? row.raw.product as Record<string, unknown>
        : {};
      const productId = resolveCatalogProductId(whitelist, {
        productId: row.productId,
        offerId: row.offerId || String(rawProduct.offer_id ?? ""),
        ozonSku: row.ozonSku || String(rawProduct.sku ?? ""),
        externalKey: row.externalKey,
      });
      return productId ? [{ ...row, productId }] : [];
    });
    const linkedAccruals = visibleAccruals.map((row) => ({ row, postingNumber: resolveFinanceAccrualPostingNumber(row, financePostingByOrderSku) }));
    const accrualCentsByPosting = new Map<string, number>();
    for (const { row, postingNumber } of linkedAccruals) {
      if (!postingNumber) continue;
      accrualCentsByPosting.set(postingNumber, (accrualCentsByPosting.get(postingNumber) ?? 0) + Math.round(Number(row.amount) * 100));
    }
    const financeSaleSkuKeys = new Set(linkedAccruals.flatMap(({ row, postingNumber }) => postingNumber
      ? financePostingSaleSkus(row.raw).map((sku) => `${postingNumber}\u0000${sku}`)
      : []));
    const returnRecordsByPosting = new Map<string, (typeof returnRows)[number][]>()
    for (const row of visibleReturnRows) {
      if (!row.postingNumber) continue;
      returnRecordsByPosting.set(row.postingNumber, [...(returnRecordsByPosting.get(row.postingNumber) ?? []), row]);
    }
    const returnCostCentsByPosting = new Map<string, number>();
    const processedReturnAccruals = new Set<string>();
    for (const { row, postingNumber } of linkedAccruals) {
      if (!postingNumber) continue;
      const accrualKey = `${postingNumber}\u0000${row.accrualDate}\u0000${row.accruedCategory}\u0000${row.accrualId}`;
      if (processedReturnAccruals.has(accrualKey)) continue;
      processedReturnAccruals.add(accrualKey);
      const returnCostCents = financeReturnLogisticsCents(row.raw);
      if (!returnCostCents) continue;
      returnCostCentsByPosting.set(postingNumber, (returnCostCentsByPosting.get(postingNumber) ?? 0) + returnCostCents);
    }
    const returnStatesByPosting = getOrderReturnStatesByPosting(pageRows, visibleReturnRows);
    return {
      items: pageRows.map((posting) => {
        const items = itemsByPosting.get(posting.id) ?? [];
        const returnState = returnStatesByPosting.get(posting.externalId) ?? null;
        const buyoutCents = items.reduce((total, { item }) => {
          if (item.ozonSku && financeSaleSkuKeys.has(`${posting.externalId}\u0000${item.ozonSku}`)) return total;
          return total + Math.round(Number(item.marketplaceBuyoutAmount ?? 0) * 100);
        }, 0);
        return {
          ...posting,
          addedCostRatePercent: addedCostRateByPostingId[posting.id] ?? null,
          addedCostBreakdown: addedCostBreakdownByPostingId[posting.id] ?? null,
          addedCostExplanation: addedCostExplanation(
            addedCostBreakdownByPostingId[posting.id],
            String(posting.status ?? ""),
            Boolean(posting.deliveredAt || posting.isMarketplaceBuyout || buyoutCents > 0),
          ),
          status: currentOrderStatus(posting.status, returnState),
          returnState,
          returnRecords: (returnRecordsByPosting.get(posting.externalId) ?? []).map((row) => ({
            externalId: row.externalId,
            status: row.status,
            destination: row.destination,
            receivedBySellerAt: row.receivedBySellerAt?.toISOString() ?? null,
          })),
          items: items.map(({ item, productSku }) => ({
            title: titleByProductId.get(item.productId) || item.title,
            sku: skuByProductId.get(item.productId) || productSku || item.offerId || item.ozonSku,
            offerId: item.offerId,
            ozonSku: item.ozonSku,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            mapped: Boolean(item.productId),
            isMarketplaceBuyout: item.isMarketplaceBuyout,
          })),
          amount: ((accrualCentsByPosting.get(posting.externalId) ?? 0) + buyoutCents) / 100,
          profit: profitByPosting.get(posting.externalId)?.profitCents === null || profitByPosting.get(posting.externalId)?.profitCents === undefined
            ? null
            : profitByPosting.get(posting.externalId)!.profitCents! / 100,
          returnCost: (returnCostCentsByPosting.get(posting.externalId) ?? 0) / 100,
        };
      }),
      pagination,
      summary,
    };
  });
}

export async function POST(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const configuredRows = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
    const configured = configuredRows[0];
    if (!configured?.ozonClientId || !configured.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
    const [job] = await db.insert(syncJobs).values({ userId, kind: "orders", status: "queued", summary: { requestedBy: "user" } }).returning();
    return Response.json({ item: job, message: "Синхронизация поставлена в очередь." }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
