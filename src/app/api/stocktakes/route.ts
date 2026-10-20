import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, stockAdjustments, stocktakeLines, stocktakes } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, nonNegativeInteger } from "../_lib/validation";

const stocktakeSchema = z.object({
  warehouse: z.enum(["seller", "ozon"]),
  countedAt: isoDate,
  note: z.string().trim().max(2000).optional().default(""),
  lines: z.array(z.object({ productId: z.string().uuid(), actualQuantity: nonNegativeInteger })).min(1),
});
const resolutionSchema = z.object({ resolutionNote: z.string().trim().max(2000).optional().default("") });

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [headers, lines, catalog] = await Promise.all([
      db.select().from(stocktakes).orderBy(desc(stocktakes.countedAt), desc(stocktakes.createdAt)),
      db.select().from(stocktakeLines),
      db.select().from(products),
    ]);
    const productById = new Map(catalog.map((product) => [product.id, product]));
    return { items: headers.map((header) => ({
      ...header,
      lines: lines.filter((line) => line.stocktakeId === header.id).map((line) => ({
        ...line, sku: productById.get(line.productId)?.sku ?? "", title: productById.get(line.productId)?.title ?? "Товар удалён",
      })),
    })) };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, stocktakeSchema);
    const ids = new Set(body.lines.map((line) => line.productId));
    if (ids.size !== body.lines.length) throw new Error("Каждый товар в пересчёте нужно указывать один раз.");
    const snapshot = await getAccountingSnapshot(new Date(`${body.countedAt}T23:59:59.999Z`));
    const currentById = new Map(snapshot.products.map((product) => [product.productId, product]));
    const header = await db.transaction(async (tx) => {
      const [created] = await tx.insert(stocktakes).values({ warehouse: body.warehouse, countedAt: body.countedAt, note: body.note })
        .onConflictDoNothing().returning();
      if (!created) throw new Error("Инвентаризация этого склада за эту дату уже существует.");
      await tx.insert(stocktakeLines).values(body.lines.map((line) => ({
        stocktakeId: created.id,
        productId: line.productId,
        expectedQuantity: currentById.get(line.productId)?.[body.warehouse === "seller" ? "sellerStock" : "ozonStock"] ?? "0",
        actualQuantity: line.actualQuantity,
      })));
      return created;
    });
    return Response.json({ item: header }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор строки инвентаризации.");
    const body = await parseBody(request, resolutionSchema);
    const line = (await db.select().from(stocktakeLines).where(eq(stocktakeLines.id, id)).limit(1))[0];
    if (!line) throw new Error("Запись не найдена.");
    const header = (await db.select().from(stocktakes).where(eq(stocktakes.id, line.stocktakeId)).limit(1))[0];
    if (!header) throw new Error("Инвентаризация не найдена.");
    await db.transaction(async (tx) => {
      await tx.update(stocktakeLines).set({ resolvedAt: new Date(), resolutionNote: body.resolutionNote }).where(eq(stocktakeLines.id, id));
      await tx.insert(stockAdjustments).values({
        stocktakeLineId: id,
        productId: line.productId,
        warehouse: header.warehouse,
        actualQuantity: line.actualQuantity,
        adjustedAt: header.countedAt,
      }).onConflictDoUpdate({
        target: stockAdjustments.stocktakeLineId,
        set: { productId: line.productId, warehouse: header.warehouse, actualQuantity: line.actualQuantity, adjustedAt: header.countedAt },
      });
    });
    return Response.json({ resolved: id, adjustedAt: header.countedAt });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор инвентаризации.");
    const [deleted] = await db.delete(stocktakes).where(eq(stocktakes.id, id)).returning({ id: stocktakes.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
