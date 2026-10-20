import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { manualWriteoffs, ozonWriteoffs, products } from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, positiveDecimal } from "../_lib/validation";

const writeoffSchema = z.object({
  productId: z.string().uuid(),
  writtenOffAt: isoDate,
  quantity: positiveDecimal,
  note: z.string().trim().max(2000).optional().default(""),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [manual, ozon, catalog] = await Promise.all([
      db.select().from(manualWriteoffs).orderBy(desc(manualWriteoffs.writtenOffAt), desc(manualWriteoffs.createdAt)),
      db.select().from(ozonWriteoffs).orderBy(desc(ozonWriteoffs.occurredAt), desc(ozonWriteoffs.updatedAt)),
      db.select().from(products),
    ]);
    const byId = new Map(catalog.map((product) => [product.id, product]));
    return { items: [
      ...manual.map((row) => {
        const product = byId.get(row.productId);
        return { ...row, kind: "manual", compensationStatus: "—", compensationAmount: null, sku: product?.sku ?? "", title: product?.title ?? "Товар удалён" };
      }),
      ...ozon.map((row) => {
        const product = byId.get(row.productId ?? "");
        return { ...row, kind: "ozon", writtenOffAt: row.occurredAt?.toISOString() ?? null, note: "", sku: product?.sku ?? row.ozonSku, title: product?.title ?? row.externalKey };
      }),
    ].sort((a, b) => String(b.writtenOffAt ?? "").localeCompare(String(a.writtenOffAt ?? ""))) };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, writeoffSchema);
    const [item] = await db.insert(manualWriteoffs).values(body).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор списания.");
    const [deleted] = await db.delete(manualWriteoffs).where(eq(manualWriteoffs.id, id)).returning({ id: manualWriteoffs.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
