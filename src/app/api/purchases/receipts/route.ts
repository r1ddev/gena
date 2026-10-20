import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, purchaseReceiptLines, purchaseReceipts, purchases } from "@/db/schema";
import { assertLocalMutation, errorResponse, parseBody } from "../../_lib/http";
import { isoDate, positiveDecimal } from "../../_lib/validation";

const linesSchema = z.array(z.object({
  productId: z.string().uuid(),
  quantity: positiveDecimal,
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

async function ensureProductsExist(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], lines: z.infer<typeof linesSchema>) {
  const productIds = lines.map((line) => line.productId);
  const existing = await tx.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
  if (existing.length !== productIds.length) throw new Error("Один из выбранных товаров не найден.");
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, receiptSchema);
    const item = await db.transaction(async (tx) => {
      const purchase = (await tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.id, body.purchaseId)).limit(1))[0];
      if (!purchase) throw new Error("Закупка не найдена.");
      await ensureProductsExist(tx, body.lines);
      const [receipt] = await tx.insert(purchaseReceipts).values({
        purchaseId: body.purchaseId,
        receivedAt: body.receivedAt,
        note: body.note,
      }).returning();
      await tx.insert(purchaseReceiptLines).values(body.lines.map((line) => ({ receiptId: receipt.id, ...line })));
      return { ...receipt, lines: body.lines };
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор приёмки.");
    const body = await parseBody(request, receiptUpdateSchema);
    const item = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: purchaseReceipts.id }).from(purchaseReceipts).where(eq(purchaseReceipts.id, id)).limit(1);
      if (!existing) throw new Error("Приёмка не найдена.");
      await ensureProductsExist(tx, body.lines);
      const [receipt] = await tx.update(purchaseReceipts).set({ receivedAt: body.receivedAt, note: body.note }).where(eq(purchaseReceipts.id, id)).returning();
      await tx.delete(purchaseReceiptLines).where(eq(purchaseReceiptLines.receiptId, id));
      await tx.insert(purchaseReceiptLines).values(body.lines.map((line) => ({ receiptId: id, ...line })));
      return { ...receipt, lines: body.lines };
    });
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор приёмки.");
    const [deleted] = await db.delete(purchaseReceipts).where(eq(purchaseReceipts.id, id)).returning({ id: purchaseReceipts.id });
    if (!deleted) throw new Error("Приёмка не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
