import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, financeAccruals, ozonPayouts, postingItems, postings, productLinks, products } from "@/db/schema";
import {
  buildFinanceOrderSkuPostingMap,
  buildFinancePostingProductIdentifiers,
  financeAccrualRelatedOfferIds,
  financeAccrualRelatedSkus,
  resolveFinanceAccrualPostingNumber,
} from "@/ozon/finance";
import { buildCatalogProductWhitelist, resolveCatalogProductId } from "@/ozon/catalog-whitelist";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";

const manualScopeSchema = z.object({
  id: z.string().trim().min(1).max(500),
  manualScope: z.enum(["current", "old", "mixed", "unknown"]).nullable(),
});

function cents(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function shiftDay(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function payoutSalesWeekStart(periodBegin: string) {
  const date = new Date(`${periodBegin}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "";
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset - 28);
  return date.toISOString().slice(0, 10);
}

function amountFromCents(value: number) {
  return value / 100;
}

function offerIdFromExternalKey(value: string) {
  return value.match(/(?:^|[|:])offer:([^:|]+)/)?.[1]?.trim() ?? "";
}

function makeAccrualAnalysis(
  row: typeof financeAccruals.$inferSelect,
  whitelist: ReturnType<typeof buildCatalogProductWhitelist>,
  activeProductIds: Set<string>,
  productsById: Map<string, { id: string; sku: string; title: string; archived: boolean }>,
  postingByOrderSku: Map<string, string>,
  postingIdentifiers: Map<string, { skus: readonly string[]; offerIds: readonly string[] }>,
) {
  const postingNumber = resolveFinanceAccrualPostingNumber(row, postingByOrderSku);
  const linkedPosting = postingNumber ? postingIdentifiers.get(postingNumber) : undefined;
  const skus = [...new Set([...financeAccrualRelatedSkus(row), ...(linkedPosting?.skus ?? [])])];
  const offerIds = [...new Set([
    ...financeAccrualRelatedOfferIds(row),
    offerIdFromExternalKey(row.externalKey),
    ...(linkedPosting?.offerIds ?? []),
  ].filter(Boolean))];
  const productIds = new Set<string>();
  if (row.productId && activeProductIds.has(row.productId)) productIds.add(row.productId);
  for (const ozonSku of skus) {
    const productId = resolveCatalogProductId(whitelist, { ozonSku });
    if (productId) productIds.add(productId);
  }
  for (const offerId of offerIds) {
    const productId = resolveCatalogProductId(whitelist, { offerId });
    if (productId) productIds.add(productId);
  }

  const hasIdentifiers = Boolean(row.productId || skus.length || offerIds.length);
  const outsideIdentifiers = [
    ...skus.filter((ozonSku) => !resolveCatalogProductId(whitelist, { ozonSku })),
    ...offerIds.filter((offerId) => !resolveCatalogProductId(whitelist, { offerId })),
  ];
  const archivedProduct = Boolean(row.productId && productsById.has(row.productId) && !activeProductIds.has(row.productId));
  const outsideCatalog = outsideIdentifiers.length > 0 || archivedProduct;

  return {
    amountCents: cents(row.amount),
    category: productIds.size ? "catalog" as const : hasIdentifiers ? "outside" as const : "unlinked" as const,
    productIds: [...productIds],
    skus,
    outsideIdentifiers: [...new Set(outsideIdentifiers)],
    mixed: productIds.size > 0 && outsideCatalog,
  };
}

async function payoutItems(rows: (typeof ozonPayouts.$inferSelect)[]) {
  if (!rows.length) return [];
  const windows = rows.map((row) => ({
    row,
    salesWeekBegin: payoutSalesWeekStart(row.periodBegin),
  }));
  const validWindows = windows.filter((window) => window.salesWeekBegin);
  const minDay = validWindows.map((window) => window.salesWeekBegin).sort()[0];
  const maxDay = validWindows.map((window) => shiftDay(window.salesWeekBegin, 6)).sort().at(-1);

  const [catalogRows, catalogLinks, externalRows, postingRows, postingItemRows] = await Promise.all([
    db.select({ id: products.id, sku: products.sku, title: products.title, archived: products.archived }).from(products),
    db.select({ productId: productLinks.productId, offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks),
    db.select({ externalKey: externalItems.externalKey, offerId: externalItems.offerId, ozonSku: externalItems.ozonSku, productId: externalItems.productId }).from(externalItems),
    db.select({ id: postings.id, externalId: postings.externalId, orderNumber: postings.orderNumber }).from(postings),
    db.select({ postingId: postingItems.postingId, externalKey: postingItems.externalKey, offerId: postingItems.offerId, ozonSku: postingItems.ozonSku }).from(postingItems),
  ]);
  const accrualRows: (typeof financeAccruals.$inferSelect)[] = minDay && maxDay
    ? await db.select().from(financeAccruals).where(and(gte(financeAccruals.accrualDate, minDay), lte(financeAccruals.accrualDate, maxDay)))
    : [];
  const activeProductIds = new Set(catalogRows.filter((product) => !product.archived).map((product) => product.id));
  const productsById = new Map(catalogRows.map((product) => [product.id, product]));
  const productWhitelist = buildCatalogProductWhitelist(catalogRows, catalogLinks, externalRows);
  const postingByOrderSku = buildFinanceOrderSkuPostingMap(postingRows, postingItemRows);
  const postingIdentifiers = buildFinancePostingProductIdentifiers(postingRows, postingItemRows);
  const accrualsByDay = new Map<string, typeof accrualRows>();
  for (const row of accrualRows) {
    const dayRows = accrualsByDay.get(row.accrualDate) ?? [];
    dayRows.push(row);
    accrualsByDay.set(row.accrualDate, dayRows);
  }

  return windows.map(({ row, salesWeekBegin }) => {
    const rowsForWeek: typeof accrualRows = [];
    for (let day = 0; day < 7; day += 1) {
      rowsForWeek.push(...(accrualsByDay.get(shiftDay(salesWeekBegin, day)) ?? []));
    }
    const totals = {
      catalog: 0,
      outside: 0,
      unlinked: 0,
      catalogRows: 0,
      outsideRows: 0,
      unlinkedRows: 0,
      mixedRows: 0,
      mixedCatalog: 0,
    };
    const productTotals = new Map<string, { amountCents: number; rows: number }>();
    const currentProductIds = new Set<string>();
    const outsideIdentifiers = new Set<string>();

    for (const accrual of rowsForWeek) {
      const analysis = makeAccrualAnalysis(accrual, productWhitelist, activeProductIds, productsById, postingByOrderSku, postingIdentifiers);
      totals[analysis.category] += analysis.amountCents;
      if (analysis.category === "catalog") totals.catalogRows += 1;
      else if (analysis.category === "outside") totals.outsideRows += 1;
      else totals.unlinkedRows += 1;
      if (analysis.mixed) {
        totals.mixedRows += 1;
        totals.mixedCatalog += analysis.amountCents;
      }
      for (const productId of analysis.productIds) currentProductIds.add(productId);
      for (const identifier of analysis.outsideIdentifiers) outsideIdentifiers.add(identifier);
      if (analysis.category === "catalog" && analysis.productIds.length === 1) {
        const productId = analysis.productIds[0];
        const total = productTotals.get(productId) ?? { amountCents: 0, rows: 0 };
        total.amountCents += analysis.amountCents;
        total.rows += 1;
        productTotals.set(productId, total);
      }
    }
    const transferCents = cents(row.amount);
    const accrualCents = totals.catalog + totals.outside + totals.unlinked;
    const differenceCents = accrualCents - transferCents;

    return {
      id: row.externalKey,
      periodBegin: row.periodBegin,
      periodEnd: row.periodEnd,
      currencyCode: row.currencyCode,
      amount: row.amount,
      manualScope: row.manualScope,
      analysis: {
        salesWeekBegin,
        salesWeekEnd: shiftDay(salesWeekBegin, 6),
        lagDays: 28,
        currentCatalogAmount: amountFromCents(totals.catalog),
        outsideCatalogAmount: amountFromCents(totals.outside),
        unlinkedAmount: amountFromCents(totals.unlinked),
        accrualAmount: amountFromCents(accrualCents),
        difference: amountFromCents(differenceCents),
        status: rowsForWeek.length === 0 ? "no_activity" as const : differenceCents === 0 ? "matched" as const : "different" as const,
        totalRows: rowsForWeek.length,
        currentCatalogRows: totals.catalogRows,
        outsideCatalogRows: totals.outsideRows,
        unlinkedRows: totals.unlinkedRows,
        mixedRows: totals.mixedRows,
        mixedCatalogAmount: amountFromCents(totals.mixedCatalog),
        currentProductTitles: [...currentProductIds].map((productId) => {
          const product = productsById.get(productId);
          return product ? `${product.title} · арт. ${product.sku}` : "Товар каталога";
        }),
        outsideIdentifiers: [...outsideIdentifiers],
        productBreakdown: [...productTotals.entries()].map(([productId, total]) => {
          const product = productsById.get(productId);
          return {
            title: product?.title ?? "Товар каталога",
            article: product?.sku ?? "",
            amount: amountFromCents(total.amountCents),
            rows: total.rows,
          };
        }).sort((left, right) => left.title.localeCompare(right.title, "ru")),
      },
    };
  });
}

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const [row] = await db.select().from(ozonPayouts).where(eq(ozonPayouts.externalKey, id)).limit(1);
      if (!row) throw new Error("Перевод не найден.");
      const [item] = await payoutItems([row]);
      return { item };
    }

    const rows = await db.select().from(ozonPayouts)
      .orderBy(desc(ozonPayouts.periodBegin), desc(ozonPayouts.periodEnd));
    return { items: await payoutItems(rows.filter((row) => cents(row.amount) !== 0)) };
  });
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, manualScopeSchema);
    const [row] = await db.update(ozonPayouts)
      .set({ manualScope: body.manualScope, updatedAt: new Date() })
      .where(eq(ozonPayouts.externalKey, body.id))
      .returning({ id: ozonPayouts.externalKey });
    if (!row) throw new Error("Перевод не найден.");
    return Response.json({ saved: true, id: row.id, manualScope: body.manualScope });
  } catch (error) { return errorResponse(error); }
}
