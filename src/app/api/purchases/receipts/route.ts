import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productLinks, products, purchaseReceiptLines, purchaseReceipts, purchases } from "@/db/schema";
import { errorResponse, parseBody, requireAuthenticatedMutation } from "../../_lib/http";
import { isoDate, positiveInteger } from "../../_lib/validation";

const linesSchema = z.array(z.object({
  productId: z.string().uuid(),
  quantity: positiveInteger,
})).min(1, "Добавьте хотя бы один фактически полученный товар.").refine(
  (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
  "Один товар должен быть одной строкой приёмки.",
);

const receiptSchema = z.object({
  purchaseId: z.string().uuid(),
  receivedAt: isoDate,
  lines: linesSchema,
  note: z.string().trim().max(2000).optional().default(""),
});

const receiptUpdateSchema = z.object({
  receivedAt: isoDate,
  lines: linesSchema,
  note: z.string().trim().max(2000).optional().default(""),
});

async function ensureProductsExist(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string, lines: z.infer<typeof linesSchema>) {
  const productIds = lines.map((line) => line.productId);
  const existing = await tx.select({ id: products.id, sku: products.sku, title: products.title, offerId: productLinks.offerId, archived: products.archived })
    .from(products).leftJoin(productLinks, and(eq(productLinks.productId, products.id), eq(productLinks.userId, userId)))
    .where(and(inArray(products.id, productIds), eq(products.userId, userId)));
  if (existing.length !== productIds.length || existing.some((product) => product.archived)) {
    throw new Error("Выберите товары из текущего каталога.");
  }
  return new Map(existing.map((product) => [product.id, {
    productSkuSnapshot: product.offerId || product.sku,
    productTitleSnapshot: product.title,
  }]));
}

export async function POST(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const body = await parseBody(request, receiptSchema);
    const item = await db.transaction(async (tx) => {
      const [purchase] = await tx.select({ id: purchases.id, productId: purchases.productId, sku: products.sku, archived: products.archived })
        .from(purchases).innerJoin(products, and(eq(products.id, purchases.productId), eq(products.userId, userId)))
        .where(and(eq(purchases.id, body.purchaseId), eq(purchases.userId, userId))).limit(1);
      if (!purchase) throw new Error("Закупка не найдена.");
      if (purchase.archived) throw new Error("Эта закупка связана с товаром вне текущего каталога.");
      const productSnapshots = await ensureProductsExist(tx, userId, body.lines);
      const [receipt] = await tx.insert(purchaseReceipts).values({
        userId,
        purchaseId: body.purchaseId,
        receivedAt: body.receivedAt,
        note: body.note,
      }).returning();
      await tx.insert(purchaseReceiptLines).values(body.lines.map((line) => ({ userId, receiptId: receipt.id, ...line, ...productSnapshots.get(line.productId)! })));
      return { ...receipt, lines: body.lines };
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор приёмки.");
    const body = await parseBody(request, receiptUpdateSchema);
    const item = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: purchaseReceipts.id, purchaseId: purchaseReceipts.purchaseId, productId: purchases.productId, sku: products.sku, archived: products.archived })
        .from(purchaseReceipts).innerJoin(purchases, eq(purchases.id, purchaseReceipts.purchaseId))
        .innerJoin(products, and(eq(products.id, purchases.productId), eq(products.userId, userId)))
        .where(and(eq(purchaseReceipts.id, id), eq(purchaseReceipts.userId, userId), eq(purchases.userId, userId))).limit(1);
      if (!existing) throw new Error("Приёмка не найдена.");
      if (existing.archived) throw new Error("Эта закупка связана с товаром вне текущего каталога.");
      const productSnapshots = await ensureProductsExist(tx, userId, body.lines);
      const [receipt] = await tx.update(purchaseReceipts).set({ receivedAt: body.receivedAt, note: body.note }).where(and(eq(purchaseReceipts.id, id), eq(purchaseReceipts.userId, userId))).returning();
      await tx.delete(purchaseReceiptLines).where(and(eq(purchaseReceiptLines.receiptId, id), eq(purchaseReceiptLines.userId, userId)));
      await tx.insert(purchaseReceiptLines).values(body.lines.map((line) => ({ userId, receiptId: id, ...line, ...productSnapshots.get(line.productId)! })));
      return { ...receipt, lines: body.lines };
    });
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор приёмки.");
    const [deleted] = await db.delete(purchaseReceipts).where(and(eq(purchaseReceipts.id, id), eq(purchaseReceipts.userId, userId))).returning({ id: purchaseReceipts.id });
    if (!deleted) throw new Error("Приёмка не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
