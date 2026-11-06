import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, expenses, externalItems, financeAccruals, ozonCompensationReports, postingItems, postings, productImages, productLinks, products } from "@/db/schema";
import { buildFinanceOrderSkuPostingMap, buildFinancePostingProductIdentifiers, financeAccrualRelatedOfferIds, financeAccrualRelatedSkus, isOzonBuyerOrderAccrual, isOzonSharedExpense, isOzonWriteoffCompensation, ozonExpenseLabel, resolveFinanceAccrualPostingNumber } from "@/ozon/finance";
import { financeExpenseComponents } from "@/ozon/expense-details";
import { matchOzonCompensationReports } from "@/ozon/compensation";
import { buildCatalogProductWhitelist, isFinanceRowOutsideCatalog } from "@/ozon/catalog-whitelist";
import { errorResponse, handleLocalGet, parseBody, requireAuthenticatedMutation } from "../_lib/http";
import { isoDate, nonNegativeDecimal } from "../_lib/validation";

const expenseSchema = z.object({
  spentAt: isoDate,
  description: z.string().trim().min(1).max(120),
  amount: nonNegativeDecimal,
  note: z.string().trim().max(2000).optional().default(""),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const source = new URL(request.url).searchParams.get("source");
    const [manualExpenses, ozonAccruals, compensationReports, postingRows, postingItemRows, externalRows, catalogRows, catalogLinks, productImageRows, settingsRows] = await Promise.all([
      db.select().from(expenses).where(eq(expenses.userId, userId)).orderBy(desc(expenses.spentAt), desc(expenses.createdAt)),
      db.select().from(financeAccruals).where(eq(financeAccruals.userId, userId)),
      db.select().from(ozonCompensationReports).where(eq(ozonCompensationReports.userId, userId)),
      db.select({ id: postings.id, externalId: postings.externalId, orderNumber: postings.orderNumber }).from(postings).where(eq(postings.userId, userId)),
      db.select({ postingId: postingItems.postingId, externalKey: postingItems.externalKey, offerId: postingItems.offerId, ozonSku: postingItems.ozonSku }).from(postingItems).where(eq(postingItems.userId, userId)),
      db.select({ externalKey: externalItems.externalKey, offerId: externalItems.offerId, ozonSku: externalItems.ozonSku, productId: externalItems.productId }).from(externalItems).where(eq(externalItems.userId, userId)),
      db.select({ id: products.id, sku: products.sku, title: products.title, archived: products.archived }).from(products).where(eq(products.userId, userId)),
      db.select({ productId: productLinks.productId, offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks).where(eq(productLinks.userId, userId)),
      db.select({ productId: productImages.productId }).from(productImages).where(eq(productImages.userId, userId)),
      db.select({ accountingStartDate: appSettings.accountingStartDate }).from(appSettings).where(eq(appSettings.userId, userId)).limit(1),
    ]);
    const accountingStartDate = settingsRows[0]?.accountingStartDate ?? "0000-01-01";
    const manualItems = manualExpenses.map((item) => ({ ...item, source: "mine", sourceLabel: "Мои" }));
    const financePostingByOrderSku = buildFinanceOrderSkuPostingMap(postingRows, postingItemRows);
    const financePostingProductIdentifiers = buildFinancePostingProductIdentifiers(postingRows, postingItemRows);
    const compensationByAccrual = matchOzonCompensationReports(ozonAccruals, compensationReports);
    const catalogWhitelist = buildCatalogProductWhitelist(catalogRows, catalogLinks, externalRows);
    const currentProductIds = new Set(catalogRows.filter((product) => !product.archived).map((product) => product.id));
    const articleByProductId = new Map(catalogRows.map((product) => [product.id, product.sku]));
    const productById = new Map(catalogRows.filter((product) => currentProductIds.has(product.id)).map((product) => [product.id, product]));
    const imageProductIds = new Set(productImageRows.map((image) => image.productId));
    const articleByOzonSku = new Map([
      ...catalogLinks.filter((link) => currentProductIds.has(link.productId)).map((link) => [link.ozonSku, articleByProductId.get(link.productId) ?? ""] as const),
      ...externalRows.filter((item) => item.productId && currentProductIds.has(item.productId) && item.ozonSku)
        .map((item) => [item.ozonSku, articleByProductId.get(item.productId!) ?? ""] as const),
    ]);
    const productIdByOzonSku = new Map<string, string>();
    const productIdByOfferId = new Map<string, string>();
    for (const link of catalogLinks) {
      if (!currentProductIds.has(link.productId)) continue;
      if (link.ozonSku) productIdByOzonSku.set(link.ozonSku, link.productId);
      if (link.offerId) productIdByOfferId.set(link.offerId, link.productId);
    }
    for (const product of catalogRows) {
      if (currentProductIds.has(product.id) && product.sku) productIdByOfferId.set(product.sku, product.id);
    }
    for (const item of externalRows) {
      if (!item.productId || !currentProductIds.has(item.productId)) continue;
      if (item.ozonSku) productIdByOzonSku.set(item.ozonSku, item.productId);
      if (item.offerId) productIdByOfferId.set(item.offerId, item.productId);
    }
    const ozonItems = ozonAccruals.flatMap((row) => {
      const unitNumber = typeof row.raw.unit_number === "string" ? row.raw.unit_number : row.postingNumber ?? "";
      const postingNumber = resolveFinanceAccrualPostingNumber(row, financePostingByOrderSku);
      const isWriteoffCompensation = isOzonWriteoffCompensation({ typeId: row.typeId, raw: row.raw });
      if (!isWriteoffCompensation && isOzonBuyerOrderAccrual({ postingNumber, category: row.accruedCategory, typeId: row.typeId })) return [];
      const isAddedCost = isOzonSharedExpense({ postingNumber, category: row.accruedCategory, typeId: row.typeId, raw: row.raw });
      const compensationDetails = compensationByAccrual.get(row.externalKey) ?? [];
      const relatedSkus = [...new Set([
        ...financeAccrualRelatedSkus(row),
        ...compensationDetails.map((line) => line.ozonSku).filter(Boolean),
      ])];
      const relatedOfferIds = [...new Set([
        ...financeAccrualRelatedOfferIds(row),
        ...compensationDetails.map((line) => line.offerId).filter(Boolean),
      ])];
      const postingProductIdentifiers = postingNumber ? financePostingProductIdentifiers.get(postingNumber) : undefined;
      const catalogFilterRow = { ...row, relatedSkus, raw: { ...row.raw, offer_id: relatedOfferIds } };
      const hasUnidentifiedCompensationLine = compensationDetails.some((line) => !line.ozonSku && !line.offerId);
      if (!hasUnidentifiedCompensationLine && isFinanceRowOutsideCatalog(catalogWhitelist, catalogFilterRow, postingProductIdentifiers)) return [];
      const resolvedSkus = [...new Set([...relatedSkus, ...(postingProductIdentifiers?.skus ?? [])])];
      const resolvedOfferIds = [...new Set([...relatedOfferIds, ...(postingProductIdentifiers?.offerIds ?? [])])];
      const ozonSku = resolvedSkus.length === 1 ? resolvedSkus[0] : "";
      const articles = [...new Set(resolvedSkus.map((sku) => articleByOzonSku.get(sku)).filter(Boolean))];
      const components = compensationDetails.length ? [] : financeExpenseComponents(row);
      const quantityBySku = new Map<string, number>();
      for (const component of components) {
        if (component.sku && component.quantity !== null && !quantityBySku.has(component.sku)) {
          quantityBySku.set(component.sku, component.quantity);
        }
      }
      const relatedProductById = new Map<string, {
        id: string;
        title: string;
        article: string;
        offerId: string;
        ozonSku: string;
        imageUrl: string | null;
        quantity: number | null;
      }>();
      if (row.productId) {
        const product = productById.get(row.productId);
        if (product) {
          const link = catalogLinks.find((candidate) => candidate.productId === product.id);
          const sku = resolvedSkus.find((candidate) => productIdByOzonSku.get(candidate) === product.id) ?? link?.ozonSku ?? "";
          relatedProductById.set(product.id, {
            id: product.id,
            title: product.title,
            article: product.sku,
            offerId: link?.offerId ?? product.sku,
            ozonSku: sku,
            imageUrl: imageProductIds.has(product.id) ? `/api/products/${product.id}/image` : null,
            quantity: quantityBySku.get(sku) ?? null,
          });
        }
      }
      for (const sku of resolvedSkus) {
        const productId = productIdByOzonSku.get(sku);
        const product = productId ? productById.get(productId) : undefined;
        if (!product) continue;
        const link = catalogLinks.find((candidate) => candidate.productId === product.id);
        relatedProductById.set(product.id, {
          id: product.id,
          title: product.title,
          article: product.sku,
          offerId: link?.offerId ?? product.sku,
          ozonSku: sku,
          imageUrl: imageProductIds.has(product.id) ? `/api/products/${product.id}/image` : null,
          quantity: quantityBySku.get(sku) ?? null,
        });
      }
      for (const offerId of resolvedOfferIds) {
        const productId = productIdByOfferId.get(offerId);
        const product = productId ? productById.get(productId) : undefined;
        if (!product || relatedProductById.has(product.id)) continue;
        const link = catalogLinks.find((candidate) => candidate.productId === product.id);
        relatedProductById.set(product.id, {
          id: product.id,
          title: product.title,
          article: product.sku,
          offerId,
          ozonSku: link?.ozonSku ?? "",
          imageUrl: imageProductIds.has(product.id) ? `/api/products/${product.id}/image` : null,
          quantity: null,
        });
      }
      const noteParts = [
        articles.length ? `Артикул ${articles.join(", ")}` : resolvedOfferIds.length ? `Артикул ${resolvedOfferIds.join(", ")}` : "",
        resolvedSkus.length ? `SKU Ozon ${resolvedSkus.join(", ")}` : "",
        compensationDetails.some((line) => line.postingReferences.length)
          ? `${[...new Set(compensationDetails.flatMap((line) => line.postingReferences))].length} отправлений`
          : "",
        unitNumber,
      ];
      const amount = Number(row.amount);
      const compensationReasons = [...new Set(compensationDetails.map((line) => line.compensationType).filter(Boolean))];
      const description = compensationDetails.length
        ? compensationReasons.length === 1 ? compensationReasons[0] : `Компенсация Ozon · ${compensationReasons.length} основания`
        : ozonExpenseLabel(row.typeId, row.raw, row.accruedCategory);
      const beforeAccountingStart = row.accrualDate < accountingStartDate;
      const accountingTreatment = beforeAccountingStart
        ? "До даты начала учёта · не входит в расчёты"
        : isWriteoffCompensation
        ? "Компенсация · в прибыли отдельно"
        : isAddedCost
          ? amount < 0 ? "Увеличивает добавочную стоимость" : amount > 0 ? "Уменьшает добавочную стоимость" : "Не влияет на добавочную стоимость"
          : "";
      return [{
        id: row.externalKey,
        spentAt: row.accrualDate,
        description,
        amount,
        note: noteParts.filter(Boolean).join(" · "),
        ozonSku,
        typeId: row.typeId,
        unitNumber,
        accruedCategory: row.accruedCategory,
        relatedSkus: resolvedSkus,
        relatedOfferIds: resolvedOfferIds,
        relatedProducts: [...relatedProductById.values()],
        components,
        compensationDetails,
        accountingTreatment,
        source: "ozon",
      }];
    });
    const items = source === "mine" ? manualItems : source === "ozon" ? ozonItems : [...manualItems, ...ozonItems];
    return { items: items.sort((left, right) => right.spentAt.localeCompare(left.spentAt)) };
  });
}

export async function POST(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const body = await parseBody(request, expenseSchema);
    const [item] = await db.insert(expenses).values({ ...body, userId }).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор расхода.");
    const body = await parseBody(request, expenseSchema);
    const [item] = await db.update(expenses).set(body).where(and(eq(expenses.id, id), eq(expenses.userId, userId))).returning();
    if (!item) throw new Error("Запись расхода не найдена.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор расхода.");
    const [deleted] = await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.userId, userId))).returning({ id: expenses.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
