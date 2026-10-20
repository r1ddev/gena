import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, returns } from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, timestampValue } from "../_lib/validation";

const eventTime = z.union([timestampValue, isoDate]).transform((value) =>
  value.length === 10 ? new Date(`${value}T23:59:59.999Z`) : new Date(value),
);
const returnUpdate = z.object({
  destination: z.enum(["seller", "ozon", "unknown"]).optional(),
  receivedBySellerAt: eventTime.optional().nullable(),
  availableAtOzon: eventTime.optional().nullable(),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [rows, catalog] = await Promise.all([
      db.select().from(returns).orderBy(desc(returns.updatedAt)),
      db.select().from(products),
    ]);
    const productById = new Map(catalog.map((product) => [product.id, product]));
    return { items: rows.map((row) => {
      const product = productById.get(row.productId ?? "");
      return { ...row, title: product?.title ?? "Товар не сопоставлен", sku: product?.sku ?? row.ozonSku, orderNumber: row.postingNumber ?? "", returnedAt: row.returnedAt?.toISOString() ?? null };
    }) };
  });
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор возврата.");
    const body = await parseBody(request, returnUpdate);
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.destination) values.destination = body.destination;
    if (body.receivedBySellerAt !== undefined) values.receivedBySellerAt = body.receivedBySellerAt;
    if (body.availableAtOzon !== undefined) values.availableAtOzon = body.availableAtOzon;
    const [item] = await db.update(returns).set(values).where(eq(returns.id, id)).returning();
    if (!item) throw new Error("Запись не найдена.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}
