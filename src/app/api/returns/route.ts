import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { postingItems, postings, products, returns } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, timestampValue } from "../_lib/validation";

const eventTime = z.union([timestampValue, isoDate]).transform((value) =>
  value.length === 10 ? new Date(`${value}T23:59:59.999Z`) : new Date(value),
);
const returnUpdate = z.object({
  destination: z.enum(["seller", "ozon", "unknown"]).optional(),
  receivedBySellerAt: eventTime.optional().nullable(),
  availableAtOzon: eventTime.optional().nullable(),
  postingNumber: z.union([z.string().trim().min(1).max(240), z.null()]).optional(),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [rows, catalog, accounting] = await Promise.all([
      db.select().from(returns).orderBy(desc(returns.updatedAt)),
      db.select().from(products),
      getAccountingSnapshot(),
    ]);
    const reconciliationIds = new Set(accounting.profitReconciliationIssues.map((issue) => issue.externalId).filter(Boolean));
    const sellerReturns = rows.filter((row) => row.destination !== "ozon");
    const postingNumbers = [...new Set(sellerReturns.map((row) => row.postingNumber).filter((value): value is string => Boolean(value)))];
    const linkedItems = postingNumbers.length
      ? await db.select({ postingNumber: postings.externalId, productId: postingItems.productId }).from(postings)
        .innerJoin(postingItems, eq(postingItems.postingId, postings.id)).where(inArray(postings.externalId, postingNumbers))
      : [];
    const validLinks = new Set(linkedItems.filter((item) => item.productId).map((item) => `${item.postingNumber}\u0000${item.productId}`));
    const productById = new Map(catalog.map((product) => [product.id, product]));
    return { items: sellerReturns.map((row) => {
      const product = productById.get(row.productId ?? "");
      return { ...row, postingMatched: Boolean(row.postingNumber && row.productId && validLinks.has(`${row.postingNumber}\u0000${row.productId}`)), profitReconciliationNeeded: reconciliationIds.has(row.externalId), title: product?.title ?? "Товар не сопоставлен", sku: product?.sku ?? row.ozonSku, orderNumber: row.postingNumber ?? "", returnedAt: row.returnedAt?.toISOString() ?? null };
    }) };
  });
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор возврата.");
    const body = await parseBody(request, returnUpdate);
    const [current] = await db.select().from(returns).where(eq(returns.id, id)).limit(1);
    if (!current) throw new Error("Запись не найдена.");
    const values: Record<string, unknown> = { updatedAt: new Date() };
    const manualFields = new Set(current.manualReconciliationFields);
    if (body.destination !== undefined) { values.destination = body.destination; manualFields.add("destination"); }
    if (body.receivedBySellerAt !== undefined) values.receivedBySellerAt = body.receivedBySellerAt;
    if (body.availableAtOzon !== undefined) values.availableAtOzon = body.availableAtOzon;
    if (body.receivedBySellerAt !== undefined) manualFields.add("receivedBySellerAt");
    if (body.availableAtOzon !== undefined) manualFields.add("availableAtOzon");
    if (body.postingNumber !== undefined) manualFields.add("postingNumber");
    if (manualFields.size > current.manualReconciliationFields.length) values.manualReconciliationFields = [...manualFields];
    if (body.postingNumber !== undefined && body.postingNumber !== null) {
      if (!current.productId) throw new Error("Сначала сопоставьте товар возврата с каталогом.");
      const [posting] = await db.select().from(postings).where(eq(postings.externalId, body.postingNumber)).limit(1);
      if (!posting) throw new Error("Отправление с таким номером не найдено.");
      const [matchingItem] = await db.select({ id: postingItems.id }).from(postingItems)
        .where(and(eq(postingItems.postingId, posting.id), eq(postingItems.productId, current.productId))).limit(1);
      if (!matchingItem) throw new Error("В этом отправлении нет товара из возврата.");
      values.postingNumber = posting.externalId;
    } else if (body.postingNumber === null) {
      values.postingNumber = null;
    }
    const [item] = await db.update(returns).set(values).where(eq(returns.id, id)).returning();
    if (!item) throw new Error("Запись не найдена.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}
