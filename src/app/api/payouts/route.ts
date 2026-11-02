import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { externalItems, financeAccruals, ozonPayouts, productLinks, products } from "@/db/schema";
import { financeAccrualRelatedSkus, ozonExpenseLabel } from "@/ozon/finance";
import { parseOzonPayoutStatement } from "@/domain/payouts";
import { handleLocalGet } from "../_lib/http";

function cents(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function payoutListItem(row: typeof ozonPayouts.$inferSelect) {
  const statement = parseOzonPayoutStatement(row.raw, row.currencyCode);
  return {
    id: row.externalKey,
    periodId: row.periodId,
    periodBegin: row.periodBegin,
    periodEnd: row.periodEnd,
    currencyCode: row.currencyCode,
    amount: row.amount,
    statement,
    detailsLoaded: statement.categories.length > 0 || statement.serviceGroups.length > 0,
  };
}

function operationProducts(
  row: typeof financeAccruals.$inferSelect,
  productById: Map<string, typeof products.$inferSelect>,
  productBySku: Map<string, typeof products.$inferSelect>,
  productSkuById: Map<string, string>,
  externalBySku: Map<string, typeof externalItems.$inferSelect>,
) {
  const skus = financeAccrualRelatedSkus({ externalKey: row.externalKey, raw: row.raw, relatedSkus: row.relatedSkus });
  const productsByKey = new Map<string, { title: string; article: string; ozonSku: string; inCatalog: boolean }>();
  if (row.productId) {
    const product = productById.get(row.productId);
    if (product && !product.archived) {
      const ozonSku = productSkuById.get(product.id) ?? skus[0] ?? "";
      productsByKey.set(product.id, { title: product.title, article: product.sku, ozonSku, inCatalog: true });
    }
  }
  for (const sku of skus) {
    const product = productBySku.get(sku);
    if (product) {
      productsByKey.set(product.id, { title: product.title, article: product.sku, ozonSku: sku, inCatalog: true });
      continue;
    }
    const externalItem = externalBySku.get(sku);
    const title = externalItem?.title?.trim() || "Товар вне каталога";
    const article = externalItem?.offerId?.trim() || "";
    productsByKey.set(`sku:${sku}`, { title, article, ozonSku: sku, inCatalog: false });
  }
  return [...productsByKey.values()];
}

function payoutOperation(row: typeof financeAccruals.$inferSelect, linkedProducts: ReturnType<typeof operationProducts>) {
  const raw = row.raw as Record<string, unknown>;
  const unitNumber = typeof raw.unit_number === "string" ? raw.unit_number : "";
  const productStatus = linkedProducts.some((product) => product.inCatalog)
    ? linkedProducts.some((product) => !product.inCatalog) ? "Смешанная отправка" : "Товар в каталоге"
    : linkedProducts.length ? "Товар вне каталога" : "Без привязки к товару";
  return {
    id: row.externalKey,
    accrualDate: row.accrualDate,
    operation: ozonExpenseLabel(row.typeId, raw, row.accruedCategory),
    accruedCategory: row.accruedCategory,
    typeId: row.typeId,
    postingNumber: row.postingNumber,
    unitNumber,
    amount: row.amount,
    relatedSkus: financeAccrualRelatedSkus({ externalKey: row.externalKey, raw, relatedSkus: row.relatedSkus }),
    products: linkedProducts,
    productStatus,
  };
}

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      const rows = (await db.select().from(ozonPayouts).orderBy(desc(ozonPayouts.periodBegin), desc(ozonPayouts.periodEnd)))
        .filter((row) => cents(row.amount) !== 0);
      if (!rows.length) return { items: [] };
      const firstDate = rows.reduce((value, row) => row.periodBegin < value ? row.periodBegin : value, rows[0].periodBegin);
      const lastDate = rows.reduce((value, row) => row.periodEnd > value ? row.periodEnd : value, rows[0].periodEnd);
      const [accrualRows, productRows, linkRows, externalRows] = await Promise.all([
        db.select().from(financeAccruals).where(and(gte(financeAccruals.accrualDate, firstDate), lte(financeAccruals.accrualDate, lastDate))),
        db.select().from(products),
        db.select().from(productLinks),
        db.select().from(externalItems),
      ]);
      const productById = new Map(productRows.map((product) => [product.id, product]));
      const productBySku = new Map<string, typeof products.$inferSelect>();
      const productSkuById = new Map<string, string>();
      for (const link of linkRows) {
        const product = productById.get(link.productId);
        if (product && !product.archived) {
          productBySku.set(link.ozonSku, product);
          productSkuById.set(product.id, link.ozonSku);
        }
      }
      const externalBySku = new Map(externalRows.filter((item) => item.ozonSku).map((item) => [item.ozonSku, item]));
      return {
        items: rows.map((row) => {
          const relatedRows = accrualRows.filter((accrual) => accrual.accrualDate >= row.periodBegin && accrual.accrualDate <= row.periodEnd);
          const searchText = relatedRows.map((accrual) => {
            const relatedProducts = operationProducts(accrual, productById, productBySku, productSkuById, externalBySku);
            const unitNumber = typeof accrual.raw.unit_number === "string" ? accrual.raw.unit_number : "";
            return [
              accrual.postingNumber,
              unitNumber,
              accrual.typeId,
              ozonExpenseLabel(accrual.typeId, accrual.raw, accrual.accruedCategory),
              ...financeAccrualRelatedSkus({ externalKey: accrual.externalKey, raw: accrual.raw, relatedSkus: accrual.relatedSkus }),
              ...relatedProducts.flatMap((product) => [product.title, product.article, product.ozonSku]),
            ].join(" ");
          }).join(" ");
          return { ...payoutListItem(row), operationCount: relatedRows.length, searchText };
        }),
      };
    }

    const [payout] = await db.select().from(ozonPayouts).where(eq(ozonPayouts.externalKey, id)).limit(1);
    if (!payout) throw new Error("Выплата не найдена.");
    const [accrualRows, productRows, linkRows, externalRows] = await Promise.all([
      db.select().from(financeAccruals).where(and(
        gte(financeAccruals.accrualDate, payout.periodBegin),
        lte(financeAccruals.accrualDate, payout.periodEnd),
      )).orderBy(desc(financeAccruals.accrualDate), desc(financeAccruals.externalKey)),
      db.select().from(products),
      db.select().from(productLinks),
      db.select().from(externalItems),
    ]);
    const productById = new Map(productRows.map((product) => [product.id, product]));
    const productBySku = new Map<string, typeof products.$inferSelect>();
    const productSkuById = new Map<string, string>();
    for (const link of linkRows) {
      const product = productById.get(link.productId);
      if (product && !product.archived) {
        productBySku.set(link.ozonSku, product);
        productSkuById.set(product.id, link.ozonSku);
      }
    }
    const externalBySku = new Map(externalRows.filter((item) => item.ozonSku).map((item) => [item.ozonSku, item]));
    const operations = accrualRows.map((row) => payoutOperation(row, operationProducts(row, productById, productBySku, productSkuById, externalBySku)));
    const totalAccrualCents = operations.reduce((total, operation) => total + cents(operation.amount), 0);
    const catalogAccrualCents = operations.reduce((total, operation) => total + (operation.productStatus === "Товар в каталоге" || operation.productStatus === "Смешанная отправка" ? cents(operation.amount) : 0), 0);
    const outsideCatalogCents = operations.reduce((total, operation) => total + (operation.productStatus === "Товар вне каталога" ? cents(operation.amount) : 0), 0);
    const unlinkedCents = operations.reduce((total, operation) => total + (operation.productStatus === "Без привязки к товару" ? cents(operation.amount) : 0), 0);
    const statement = parseOzonPayoutStatement(payout.raw, payout.currencyCode);
    const comparable = payout.currencyCode.toUpperCase() === "RUB";

    return {
      item: {
        ...payoutListItem(payout),
        statement,
        operations,
        reconciliation: {
          payoutAmount: payout.amount,
          accrualsAmount: (totalAccrualCents / 100).toFixed(2),
          catalogAccrualsAmount: (catalogAccrualCents / 100).toFixed(2),
          outsideCatalogAmount: (outsideCatalogCents / 100).toFixed(2),
          unlinkedAmount: (unlinkedCents / 100).toFixed(2),
          difference: comparable ? ((cents(payout.amount) - totalAccrualCents) / 100).toFixed(2) : null,
        },
      },
    };
  });
}
