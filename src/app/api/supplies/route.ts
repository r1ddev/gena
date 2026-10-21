import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productLinks, products, supplies, supplyLines } from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, nonNegativeDecimal, positiveInteger } from "../_lib/validation";

const supplySchema = z.object({
  suppliedAt: isoDate,
  shippingCost: nonNegativeDecimal,
  note: z.string().trim().max(2000).optional().default(""),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    quantity: positiveInteger,
  })).min(1),
});

function assertUniqueProductLines(lines: { productId: string }[]) {
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
    throw new Error("В одной поставке товар должен быть указан одной строкой.");
  }
}

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
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
          sku: productById.get(line.productId)?.sku ?? line.productSkuSnapshot,
          title: productById.get(line.productId)?.title ?? line.productTitleSnapshot,
        })),
        articles: matching.map((line) => {
          const article = productById.get(line.productId)?.sku || line.productSkuSnapshot || "Артикул не указан";
          const quantity = Number(line.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
          return `${article} × ${quantity}`;
        }).join(", "),
        quantity: matching.reduce((sum, line) => sum + Number(line.quantity), 0),
      };
    }) };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, supplySchema);
    assertUniqueProductLines(body.lines);
    const item = await db.transaction(async (tx) => {
      const productsById = await loadProductSnapshots(tx, body.lines);
      const [header] = await tx.insert(supplies).values({
        suppliedAt: body.suppliedAt,
        shippingCost: body.shippingCost,
        note: body.note,
      }).returning();
      await tx.insert(supplyLines).values(body.lines.map((line) => ({ supplyId: header.id, ...line, ...productsById.get(line.productId)! })));
      return header;
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор поставки.");
    const supplyId = z.string().uuid().parse(id);
    const body = await parseBody(request, supplySchema);
    assertUniqueProductLines(body.lines);
    const item = await db.transaction(async (tx) => {
      const productsById = await loadProductSnapshots(tx, body.lines);
      const [updated] = await tx.update(supplies).set({
        suppliedAt: body.suppliedAt,
        shippingCost: body.shippingCost,
        note: body.note,
      }).where(eq(supplies.id, supplyId)).returning();
      if (!updated) throw new Error("Поставка не найдена.");
      await tx.delete(supplyLines).where(eq(supplyLines.supplyId, supplyId));
      await tx.insert(supplyLines).values(body.lines.map((line) => ({ supplyId, ...line, ...productsById.get(line.productId)! })));
      return updated;
    });
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}

async function loadProductSnapshots(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], lines: { productId: string }[]) {
  const productIds = lines.map((line) => line.productId);
  const rows = await tx.select({ id: products.id, sku: products.sku, title: products.title, offerId: productLinks.offerId })
    .from(products).leftJoin(productLinks, eq(productLinks.productId, products.id)).where(inArray(products.id, productIds));
  if (rows.length !== productIds.length) throw new Error("Один из выбранных товаров не найден.");
  return new Map(rows.map((product) => [product.id, {
    productSkuSnapshot: product.offerId || product.sku,
    productTitleSnapshot: product.title,
  }]));
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
