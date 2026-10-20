import { desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import { products, purchaseReceiptLines, purchaseReceipts, purchases, purchaseStatusEnum } from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, nonNegativeDecimal, positiveInteger } from "../_lib/validation";

const purchaseSchema = z.object({
  productId: z.string().uuid(),
  purchasedAt: isoDate,
  orderedQuantity: positiveInteger,
  amountPaid: nonNegativeDecimal,
  note: z.string().trim().max(2000).optional().default(""),
});

const purchaseStatusSchema = z.object({ status: z.enum(purchaseStatusEnum.enumValues) });

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [purchaseRows, receipts, receiptLines, catalog] = await Promise.all([
      db.select().from(purchases).orderBy(desc(purchases.purchasedAt), desc(purchases.createdAt)),
      db.select().from(purchaseReceipts),
      db.select().from(purchaseReceiptLines),
      db.select().from(products),
    ]);
    const productById = new Map(catalog.map((product) => [product.id, product]));
    const linesByReceiptId = new Map<string, typeof receiptLines>();
    for (const line of receiptLines) linesByReceiptId.set(line.receiptId, [...(linesByReceiptId.get(line.receiptId) ?? []), line]);
    return { items: purchaseRows.map((purchase) => {
      const purchaseReceiptsForRow = receipts.filter((receipt) => receipt.purchaseId === purchase.id);
      const received = purchaseReceiptsForRow.reduce((sum, receipt) => sum.plus((linesByReceiptId.get(receipt.id) ?? []).reduce((lineSum, line) => lineSum.plus(line.quantity), new Decimal(0))), new Decimal(0));
      const ordered = new Decimal(purchase.orderedQuantity);
      const product = productById.get(purchase.productId);
      return {
        ...purchase,
        sku: product?.sku ?? "",
        title: product?.title ?? "Товар удалён",
        receipts: purchaseReceiptsForRow.map((receipt) => ({
          ...receipt,
          lines: (linesByReceiptId.get(receipt.id) ?? []).map((line) => {
            const actualProduct = productById.get(line.productId);
            return { ...line, sku: actualProduct?.sku ?? "", title: actualProduct?.title ?? "Товар удалён" };
          }),
        })),
        receivedQuantity: received.toFixed(3),
        expectedQuantity: purchase.status === "completed" ? "0.000" : Decimal.max(0, ordered.minus(received)).toFixed(3),
        receiptStatus: purchase.status === "completed" ? "Завершена" : received.isZero() ? "Не начата" : "В процессе",
      };
    }) };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, purchaseSchema);
    const [item] = await db.insert(purchases).values(body).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор закупки.");
    const body = await parseBody(request, purchaseStatusSchema);
    const [item] = await db.update(purchases).set({ status: body.status }).where(eq(purchases.id, id)).returning();
    if (!item) throw new Error("Закупка не найдена.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор закупки.");
    const [deleted] = await db.delete(purchases).where(eq(purchases.id, id)).returning({ id: purchases.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
