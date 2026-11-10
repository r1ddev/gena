import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, manualWriteoffs, ozonWriteoffs, productLinks, products } from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, positiveInteger } from "../_lib/validation";

const writeoffSchema = z.object({
  productId: z.string().uuid(),
  writtenOffAt: isoDate,
  quantity: positiveInteger,
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
    const skus = [...new Set(ozon.map((row) => row.ozonSku).filter(Boolean))];
    const [links, externalProducts] = await Promise.all([
      skus.length ? db.select().from(productLinks).where(inArray(productLinks.ozonSku, skus)) : Promise.resolve([]),
      skus.length ? db.select().from(externalItems).where(inArray(externalItems.ozonSku, skus)).orderBy(desc(externalItems.lastSeenAt)) : Promise.resolve([]),
    ]);
    const linkBySku = new Map(links.map((link) => [link.ozonSku, link]));
    const offersBySku = new Map<string, Set<string>>();
    for (const item of [...ozon, ...links, ...externalProducts]) {
      const sku = "ozonSku" in item ? item.ozonSku : "";
      const offerId = "offerId" in item ? item.offerId : "";
      if (!sku || !offerId) continue;
      offersBySku.set(sku, new Set([...(offersBySku.get(sku) ?? []), offerId]));
    }
    const offerBySku = new Map([...offersBySku].flatMap(([sku, offers]) => offers.size === 1 ? [[sku, [...offers][0]] as const] : []));
    const titleBySku = new Map<string, string>();
    for (const item of externalProducts) {
      if (item.ozonSku && item.title && item.title !== `Ozon SKU ${item.ozonSku}` && !titleBySku.has(item.ozonSku)) {
        titleBySku.set(item.ozonSku, item.title);
      }
    }
    return { items: [
      ...manual.map((row) => {
        const product = byId.get(row.productId);
        return { ...row, kind: "manual", compensationStatus: "—", compensationAmount: null, sku: product?.sku ?? "", title: product?.title ?? "Товар удалён" };
      }),
      ...ozon.map((row) => {
        const link = linkBySku.get(row.ozonSku);
        const product = byId.get(row.productId ?? "") ?? byId.get(link?.productId ?? "");
        const offerId = row.offerId || link?.offerId || offerBySku.get(row.ozonSku) || "";
        const rawTitle = typeof row.raw.name === "string" ? row.raw.name : "";
        return {
          ...row,
          productId: product?.id ?? null,
          offerId,
          ozonSku: row.ozonSku,
          kind: "ozon",
          writtenOffAt: row.occurredAt?.toISOString() ?? null,
          note: "",
          sku: product?.sku || offerId || row.ozonSku,
          title: product?.title || titleBySku.get(row.ozonSku) || rawTitle || "Товар не сопоставлен",
        };
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
