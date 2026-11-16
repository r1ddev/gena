import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, manualWriteoffs, ozonWriteoffs, productLinks, products } from "@/db/schema";
import { errorResponse, handleLocalGet, parseBody, requireAuthenticatedMutation } from "../_lib/http";
import { isoDate, positiveInteger } from "../_lib/validation";
import { buildCatalogProductWhitelist, resolveCatalogProductId } from "@/ozon/catalog-whitelist";

const writeoffSchema = z.object({
  productId: z.string().uuid(),
  writtenOffAt: isoDate,
  quantity: positiveInteger,
  note: z.string().trim().max(2000).optional().default(""),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const [manualRows, ozonRows, catalog, links, externalRows] = await Promise.all([
      db.select().from(manualWriteoffs).where(eq(manualWriteoffs.userId, userId)).orderBy(desc(manualWriteoffs.writtenOffAt), desc(manualWriteoffs.createdAt)),
      db.select().from(ozonWriteoffs).where(eq(ozonWriteoffs.userId, userId)).orderBy(desc(ozonWriteoffs.occurredAt), desc(ozonWriteoffs.updatedAt)),
      db.select().from(products).where(eq(products.userId, userId)),
      db.select({ productId: productLinks.productId, offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks).where(eq(productLinks.userId, userId)),
      db.select({ externalKey: externalItems.externalKey, offerId: externalItems.offerId, ozonSku: externalItems.ozonSku, productId: externalItems.productId }).from(externalItems).where(eq(externalItems.userId, userId)),
    ]);
    const whitelist = buildCatalogProductWhitelist(catalog, links, externalRows);
    const manual = manualRows.filter((row) => whitelist.productIds.has(row.productId));
    const ozon = ozonRows.flatMap((row) => {
      const productId = resolveCatalogProductId(whitelist, row);
      return productId ? [{ ...row, productId }] : [];
    });
    const byId = new Map(catalog.filter((product) => whitelist.productIds.has(product.id)).map((product) => [product.id, product]));
    const skus = [...new Set(ozon.map((row) => row.ozonSku).filter(Boolean))];
    const [skuLinks, externalProducts] = await Promise.all([
      skus.length ? db.select().from(productLinks).where(and(eq(productLinks.userId, userId), inArray(productLinks.ozonSku, skus))) : Promise.resolve([]),
      skus.length ? db.select().from(externalItems).where(and(eq(externalItems.userId, userId), inArray(externalItems.ozonSku, skus))).orderBy(desc(externalItems.lastSeenAt)) : Promise.resolve([]),
    ]);
    const linkBySku = new Map(skuLinks.map((link) => [link.ozonSku, link]));
    const offersBySku = new Map<string, Set<string>>();
    for (const item of [...ozon, ...skuLinks, ...externalProducts]) {
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
        return { ...row, kind: "manual", compensationStatus: "—", compensationAmount: null, sku: product?.sku ?? row.productSkuSnapshot, title: product?.title ?? (row.productTitleSnapshot || "Товар удалён") };
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
    const userId = await requireAuthenticatedMutation(request);
    const body = await parseBody(request, writeoffSchema);
    const [product] = await db.select({ id: products.id, sku: products.sku, title: products.title, offerId: productLinks.offerId, archived: products.archived })
      .from(products).leftJoin(productLinks, and(eq(productLinks.productId, products.id), eq(productLinks.userId, userId))).where(and(eq(products.id, body.productId), eq(products.userId, userId))).limit(1);
    if (!product || product.archived) throw new Error("Выберите товар из текущего каталога.");
    const [item] = await db.insert(manualWriteoffs).values({
      userId,
      ...body,
      productSkuSnapshot: product.offerId || product.sku,
      productTitleSnapshot: product.title,
    }).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор списания.");
    const [deleted] = await db.delete(manualWriteoffs).where(and(eq(manualWriteoffs.id, id), eq(manualWriteoffs.userId, userId))).returning({ id: manualWriteoffs.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
