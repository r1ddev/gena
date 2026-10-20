import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, supplies, supplyLines } from "@/db/schema";
import { assertLocalMutation, errorResponse, handle, parseBody } from "../_lib/http";
import { isoDate, nonNegativeDecimal, positiveDecimal } from "../_lib/validation";

const supplySchema = z.object({
  suppliedAt: isoDate,
  shippingCost: nonNegativeDecimal,
  note: z.string().trim().max(2000).optional().default(""),
  lines: z.array(z.object({ productId: z.string().uuid(), quantity: positiveDecimal })).min(1),
});

export async function GET() {
  return handle(async () => {
    const [headers, lines, catalog] = await Promise.all([
      db.select().from(supplies).orderBy(desc(supplies.suppliedAt), desc(supplies.createdAt)),
      db.select().from(supplyLines),
      db.select().from(products),
    ]);
    const productById = new Map(catalog.map((product) => [product.id, product]));
    return { items: headers.map((supply) => {
      const matching = lines.filter((line) => line.supplyId === supply.id);
      return {
        ...supply,
        lines: matching.map((line) => ({
          ...line,
          title: productById.get(line.productId)?.title ?? "Товар удалён",
          sku: productById.get(line.productId)?.sku ?? "",
        })),
        products: matching.map((line) => productById.get(line.productId)?.title ?? "Товар удалён").join(", "),
        quantity: matching.reduce((sum, line) => sum + Number(line.quantity), 0),
      };
    }) };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, supplySchema);
    const productIds = new Set(body.lines.map((line) => line.productId));
    if (productIds.size !== body.lines.length) throw new Error("В одной поставке товар должен быть указан одной строкой.");
    const item = await db.transaction(async (tx) => {
      const [header] = await tx.insert(supplies).values({
        suppliedAt: body.suppliedAt,
        shippingCost: body.shippingCost,
        note: body.note,
      }).returning();
      await tx.insert(supplyLines).values(body.lines.map((line) => ({ supplyId: header.id, ...line })));
      return header;
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор поставки.");
    const [deleted] = await db.delete(supplies).where(eq(supplies.id, id)).returning({ id: supplies.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
