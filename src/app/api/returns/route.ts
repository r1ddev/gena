import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, financeAccruals, ozonWriteoffs, postingItems, postings, productLinks, products, returns } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { errorResponse, handleLocalGet, parseBody, requireAuthenticatedMutation } from "../_lib/http";
import { isoDate, timestampValue } from "../_lib/validation";
import { buildCatalogProductWhitelist, isFinanceRowOutsideCatalog, resolveCatalogProductId } from "@/ozon/catalog-whitelist";
import { buildFinanceOrderSkuPostingMap, buildFinancePostingProductIdentifiers, isOzonWriteoffCompensation, ozonExpenseLabel, resolveFinanceAccrualPostingNumber } from "@/ozon/finance";

const eventTime = z.union([timestampValue, isoDate]).transform((value) =>
  value.length === 10 ? new Date(`${value}T23:59:59.999Z`) : new Date(value),
);
const returnUpdate = z.object({
  destination: z.enum(["seller", "ozon", "unknown"]).optional(),
  receivedBySellerAt: eventTime.optional().nullable(),
  availableAtOzon: eventTime.optional().nullable(),
  postingNumber: z.union([z.string().trim().min(1).max(240), z.null()]).optional(),
  writeoff: z.literal(true).optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const [rows, catalog, catalogLinks, externalCatalogRows, accounting] = await Promise.all([
      db.select().from(returns).where(eq(returns.userId, userId)).orderBy(desc(returns.updatedAt)),
      db.select().from(products).where(eq(products.userId, userId)),
      db.select({ productId: productLinks.productId, offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks).where(eq(productLinks.userId, userId)),
      db.select({ externalKey: externalItems.externalKey, offerId: externalItems.offerId, ozonSku: externalItems.ozonSku, productId: externalItems.productId }).from(externalItems).where(eq(externalItems.userId, userId)),
      getAccountingSnapshot(userId),
    ]);
    const whitelist = buildCatalogProductWhitelist(catalog, catalogLinks, externalCatalogRows);
    const reconciliationIds = new Set(accounting.profitReconciliationIssues.map((issue) => issue.externalId).filter(Boolean));
    const productData = (row: (typeof rows)[number]) =>
      row.raw.product && typeof row.raw.product === "object" && !Array.isArray(row.raw.product)
        ? row.raw.product as Record<string, unknown>
        : {};
    const returnBarcode = (row: (typeof rows)[number]) => {
      const logistic = row.raw.logistic && typeof row.raw.logistic === "object" && !Array.isArray(row.raw.logistic)
        ? row.raw.logistic as Record<string, unknown>
        : {};
      return typeof logistic.barcode === "string" ? logistic.barcode : "";
    };
    const candidateReturns = rows.filter((row) => row.destination !== "ozon");
    const candidatePostingNumbers = [...new Set(candidateReturns.map((row) => row.postingNumber).filter((value): value is string => Boolean(value)))];
    const candidatePostings = candidatePostingNumbers.length
      ? await db.select().from(postings).where(and(eq(postings.userId, userId), inArray(postings.externalId, candidatePostingNumbers)))
      : [];
    const candidatePostingIds = candidatePostings.map((posting) => posting.id);
    const candidatePostingItemRows = candidatePostingIds.length
      ? await db.select({ item: postingItems, productSku: products.sku, productTitle: products.title })
        .from(postingItems).leftJoin(products, and(eq(postingItems.productId, products.id), eq(products.userId, userId)))
        .where(and(eq(postingItems.userId, userId), inArray(postingItems.postingId, candidatePostingIds)))
      : [];
    const productIdsByCandidatePosting = new Map<string, Set<string>>();
    const resolvedItemsByCandidatePosting = new Map<string, number>();
    const allItemsByCandidatePosting = new Map<string, number>();
    for (const { item } of candidatePostingItemRows) {
      allItemsByCandidatePosting.set(item.postingId, (allItemsByCandidatePosting.get(item.postingId) ?? 0) + 1);
      const productId = resolveCatalogProductId(whitelist, item);
      if (!productId) continue;
      resolvedItemsByCandidatePosting.set(item.postingId, (resolvedItemsByCandidatePosting.get(item.postingId) ?? 0) + 1);
      productIdsByCandidatePosting.set(item.postingId, new Set([...(productIdsByCandidatePosting.get(item.postingId) ?? []), productId]));
    }
    const candidatePostingByNumber = new Map(candidatePostings.map((posting) => [posting.externalId, posting]));
    const sellerReturns = candidateReturns.flatMap((row) => {
      const rawProduct = productData(row);
      const sku = (row.ozonSku || String(rawProduct.sku ?? "")).trim();
      const offerId = (row.offerId || String(rawProduct.offer_id ?? "")).trim();
      const productId = resolveCatalogProductId(whitelist, { externalKey: row.externalKey, offerId, ozonSku: sku, productId: row.productId });
      if (productId) return [{ ...row, productId }];
      const hasProductIdentifier = Boolean(row.productId || sku || offerId || /(?:^|[|:])(?:sku|offer):[^?:|]/.test(row.externalKey));
      const posting = row.postingNumber ? candidatePostingByNumber.get(row.postingNumber) : undefined;
      if (hasProductIdentifier || !posting) return [];
      const ids = productIdsByCandidatePosting.get(posting.id);
      const allItemsResolved = allItemsByCandidatePosting.get(posting.id) === resolvedItemsByCandidatePosting.get(posting.id);
      if (!ids || ids.size !== 1 || !allItemsResolved) return [];
      return [{ ...row, productId: [...ids][0] }];
    });
    const postingNumbers = [...new Set(sellerReturns.map((row) => row.postingNumber).filter((value): value is string => Boolean(value)))];
    const sellerReturnProducts = sellerReturns.map((row) => {
      const product = productData(row);
      return {
        offerId: row.offerId || String(product.offer_id ?? ""),
        ozonSku: row.ozonSku || String(product.sku ?? ""),
      };
    });
    const skus = [...new Set(sellerReturnProducts.map((product) => product.ozonSku).filter(Boolean))];
    const [orderProducts, catalogSkuLinks, externalProducts] = await Promise.all([
      skus.length ? db.select({ offerId: postingItems.offerId, ozonSku: postingItems.ozonSku }).from(postingItems).where(and(eq(postingItems.userId, userId), inArray(postingItems.ozonSku, skus))) : Promise.resolve([]),
      skus.length ? db.select({ offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks).where(and(eq(productLinks.userId, userId), inArray(productLinks.ozonSku, skus))) : Promise.resolve([]),
      skus.length ? db.select({ offerId: externalItems.offerId, ozonSku: externalItems.ozonSku }).from(externalItems).where(and(eq(externalItems.userId, userId), inArray(externalItems.ozonSku, skus))) : Promise.resolve([]),
    ]);
    const offersBySku = new Map<string, Set<string>>();
    for (const row of [...sellerReturnProducts, ...orderProducts, ...catalogSkuLinks, ...externalProducts]) {
      if (!row.ozonSku || !row.offerId) continue;
      offersBySku.set(row.ozonSku, new Set([...(offersBySku.get(row.ozonSku) ?? []), row.offerId]));
    }
    const uniqueOfferBySku = new Map([...offersBySku].flatMap(([sku, offers]) => offers.size === 1 ? [[sku, [...offers][0]] as const] : []));
    const sellerReturnPostingIds = new Set(sellerReturns.map((row) => row.postingNumber ? candidatePostingByNumber.get(row.postingNumber)?.id : null).filter((value): value is string => Boolean(value)));
    const linkedPostings = candidatePostings.filter((posting) => sellerReturnPostingIds.has(posting.id));
    const linkedPostingIds = linkedPostings.map((posting) => posting.id);
    const orderNumbers = [...new Set(linkedPostings.map((posting) => posting.orderNumber).filter(Boolean))];
    const [linkedItemRows, accrualRows] = await Promise.all([
      Promise.resolve(candidatePostingItemRows.filter(({ item }) => linkedPostingIds.includes(item.postingId))),
      (() => {
        const numbers = [...new Set([...postingNumbers, ...orderNumbers])];
        const conditions = [
          ...(numbers.length ? [inArray(financeAccruals.postingNumber, numbers)] : []),
          ...(orderNumbers.length ? [inArray(sql<string>`${financeAccruals.raw}->>'unit_number'`, orderNumbers)] : []),
        ];
        return conditions.length ? db.select().from(financeAccruals).where(and(eq(financeAccruals.userId, userId), or(...conditions))) : Promise.resolve([]);
      })(),
    ]);
    const visibleLinkedItems = linkedItemRows.flatMap(({ item, productSku, productTitle }) => {
      const productId = resolveCatalogProductId(whitelist, item);
      return productId ? [{ item: { ...item, productId }, productSku, productTitle }] : [];
    });
    const validLinks = new Set(visibleLinkedItems
      .filter(({ item }) => item.productId)
      .flatMap(({ item }) => {
        const postingNumber = linkedPostings.find((posting) => posting.id === item.postingId)?.externalId;
        return postingNumber ? [`${postingNumber}\u0000${item.productId}`] : [];
      }));
    const postingByNumber = new Map(linkedPostings.map((posting) => [posting.externalId, posting]));
    const itemsByPostingId = new Map<string, typeof visibleLinkedItems>();
    for (const item of visibleLinkedItems) {
      itemsByPostingId.set(item.item.postingId, [...(itemsByPostingId.get(item.item.postingId) ?? []), item]);
    }
    const financePostingByOrderSku = buildFinanceOrderSkuPostingMap(
      linkedPostings.map(({ id, externalId, orderNumber }) => ({ id, externalId, orderNumber })),
      linkedItemRows.map(({ item }) => ({ postingId: item.postingId, ozonSku: item.ozonSku })),
    );
    const postingProductIdentifiers = buildFinancePostingProductIdentifiers(
      linkedPostings,
      linkedItemRows.map(({ item }) => item),
    );
    const operationsByPosting = new Map<string, typeof accrualRows>();
    for (const accrual of accrualRows) {
      const postingNumber = resolveFinanceAccrualPostingNumber(accrual, financePostingByOrderSku);
      if (!postingNumber || !postingByNumber.has(postingNumber)) continue;
      if (isFinanceRowOutsideCatalog(whitelist, accrual, postingProductIdentifiers.get(postingNumber))) continue;
      operationsByPosting.set(postingNumber, [...(operationsByPosting.get(postingNumber) ?? []), accrual]);
    }
    const relatedSkus = [...new Set([
      ...skus,
      ...visibleLinkedItems.map(({ item }) => item.ozonSku),
    ].filter(Boolean))];
    const writeoffRows = relatedSkus.length
      ? await db.select().from(ozonWriteoffs).where(and(eq(ozonWriteoffs.userId, userId), inArray(ozonWriteoffs.ozonSku, relatedSkus)))
      : [];
    const productById = new Map(catalog.filter((product) => whitelist.productIds.has(product.id)).map((product) => [product.id, product]));
    return { items: sellerReturns.map((row) => {
      const product = productById.get(row.productId ?? "");
      const rawProduct = productData(row);
      const ozonTitle = typeof rawProduct.name === "string" ? rawProduct.name : "";
      const ozonSku = row.ozonSku || String(rawProduct.sku ?? "");
      const sellerArticle = row.offerId || String(rawProduct.offer_id ?? "") || uniqueOfferBySku.get(ozonSku) || catalogLinks.find((link) => link.productId === product?.id)?.offerId || product?.sku || "";
      const posting = row.postingNumber ? postingByNumber.get(row.postingNumber) : undefined;
      const postingItemsForReturn = posting ? itemsByPostingId.get(posting.id) ?? [] : [];
      const matchedPostingItem = postingItemsForReturn.find(({ item }) =>
        (row.productId && item.productId === row.productId) || (ozonSku && item.ozonSku === ozonSku),
      );
      const returnSku = ozonSku || matchedPostingItem?.item.ozonSku || "";
      const matchingWriteoffs = posting && returnSku
        ? writeoffRows.filter((writeoff) => {
          if (!resolveCatalogProductId(whitelist, writeoff)) return false;
          const rawPostingNumber = typeof writeoff.raw.posting_number === "string" ? writeoff.raw.posting_number : writeoff.externalId.split(":", 1)[0];
          return rawPostingNumber === posting.externalId && writeoff.ozonSku === returnSku;
        })
        : [];
      const postingOperations = posting ? operationsByPosting.get(posting.externalId) ?? [] : [];
      return {
        ...row,
        offerId: sellerArticle,
        ozonSku,
        postingMatched: Boolean(row.postingNumber && row.productId && validLinks.has(`${row.postingNumber}\u0000${row.productId}`)),
        profitReconciliationNeeded: reconciliationIds.has(row.externalId),
        title: product?.title || ozonTitle || "Товар не сопоставлен",
        sku: product?.sku ?? sellerArticle,
        orderNumber: row.postingNumber ?? "",
        returnBarcode: returnBarcode(row),
        returnedAt: row.returnedAt?.toISOString() ?? null,
        linkedPosting: posting ? {
          externalId: posting.externalId,
          orderNumber: posting.orderNumber,
          status: posting.status,
          orderDate: posting.orderDate?.toISOString() ?? null,
          deliveredAt: posting.deliveredAt?.toISOString() ?? null,
        } : null,
        linkedItems: postingItemsForReturn.map(({ item, productSku, productTitle }) => ({
          title: productTitle || item.title,
          article: productSku || item.offerId,
          ozonSku: item.ozonSku,
          quantity: item.quantity,
          price: item.price,
          productId: item.productId,
        })),
        linkedOperations: postingOperations.filter((accrual) => !isOzonWriteoffCompensation({ typeId: accrual.typeId, raw: accrual.raw })).map((accrual) => ({
          date: accrual.accrualDate,
          label: ozonExpenseLabel(accrual.typeId, accrual.raw, accrual.accruedCategory),
          amount: accrual.amount,
          category: accrual.accruedCategory,
          typeId: accrual.typeId,
        })),
        linkedCompensations: [
          ...postingOperations.filter((accrual) => isOzonWriteoffCompensation({ typeId: accrual.typeId, raw: accrual.raw })).map((accrual) => ({
            id: `accrual-${accrual.id}`,
            origin: "Начисление Ozon",
            matchBasis: "По отправлению",
            date: accrual.accrualDate,
            status: ozonExpenseLabel(accrual.typeId, accrual.raw, accrual.accruedCategory),
            amount: accrual.amount,
            quantity: null,
            ozonSku: "",
          })),
          ...matchingWriteoffs.map((writeoff) => ({
            id: writeoff.id,
            origin: "Списание Ozon",
            matchBasis: "По отправлению и SKU",
            date: writeoff.occurredAt?.toISOString() ?? null,
            status: writeoff.compensationStatus,
            amount: writeoff.compensationAmount,
            quantity: writeoff.quantity,
            ozonSku: writeoff.ozonSku,
          })),
        ],
      };
    }) };
  });
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор возврата.");
    const body = await parseBody(request, returnUpdate);
    const [current, catalog, catalogLinks, externalCatalogRows] = await Promise.all([
      db.select().from(returns).where(and(eq(returns.id, id), eq(returns.userId, userId))).limit(1).then((rows) => rows[0]),
      db.select().from(products).where(eq(products.userId, userId)),
      db.select({ productId: productLinks.productId, offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks).where(eq(productLinks.userId, userId)),
      db.select({ externalKey: externalItems.externalKey, offerId: externalItems.offerId, ozonSku: externalItems.ozonSku, productId: externalItems.productId }).from(externalItems).where(eq(externalItems.userId, userId)),
    ]);
    if (!current) throw new Error("Запись не найдена.");
    const whitelist = buildCatalogProductWhitelist(catalog, catalogLinks, externalCatalogRows);
    const rawProduct = current.raw.product && typeof current.raw.product === "object" && !Array.isArray(current.raw.product)
      ? current.raw.product as Record<string, unknown>
      : {};
    const catalogProductId = resolveCatalogProductId(whitelist, {
      productId: current.productId,
      offerId: current.offerId || String(rawProduct.offer_id ?? ""),
      ozonSku: current.ozonSku || String(rawProduct.sku ?? ""),
      externalKey: current.externalKey,
    });
    if (!catalogProductId) throw new Error("Возврат не связан с товаром из каталога.");
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (current.productId !== catalogProductId) values.productId = catalogProductId;
    const manualFields = new Set(current.manualReconciliationFields);
    if (body.note !== undefined) values.note = body.note;
    if (body.writeoff) {
      values.writtenOffAt = current.writtenOffAt ?? new Date();
      manualFields.add("writtenOffAt");
    }
    if (body.destination !== undefined) { values.destination = body.destination; manualFields.add("destination"); }
    if (body.receivedBySellerAt !== undefined) {
      if (body.receivedBySellerAt && current.writtenOffAt) throw new Error("Этот товар уже списан и не может быть добавлен на склад.");
      values.receivedBySellerAt = body.receivedBySellerAt;
    }
    if (body.availableAtOzon !== undefined) values.availableAtOzon = body.availableAtOzon;
    if (body.receivedBySellerAt !== undefined) manualFields.add("receivedBySellerAt");
    if (body.availableAtOzon !== undefined) manualFields.add("availableAtOzon");
    if (body.postingNumber !== undefined) manualFields.add("postingNumber");
    if (manualFields.size > current.manualReconciliationFields.length) values.manualReconciliationFields = [...manualFields];
    if (body.postingNumber !== undefined && body.postingNumber !== null) {
      const [posting] = await db.select().from(postings).where(and(eq(postings.userId, userId), eq(postings.externalId, body.postingNumber))).limit(1);
      if (!posting) throw new Error("Отправление с таким номером не найдено.");
      const matchingItems = await db.select().from(postingItems).where(and(eq(postingItems.userId, userId), eq(postingItems.postingId, posting.id)));
      if (!matchingItems.some((item) => resolveCatalogProductId(whitelist, item) === catalogProductId)) {
        throw new Error("В этом отправлении нет товара из возврата.");
      }
      values.postingNumber = posting.externalId;
    } else if (body.postingNumber === null) {
      values.postingNumber = null;
    }
    const [item] = await db.update(returns).set(values).where(and(eq(returns.id, id), eq(returns.userId, userId))).returning();
    if (!item) throw new Error("Запись не найдена.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}
