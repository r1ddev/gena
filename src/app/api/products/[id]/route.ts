import { and, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, productImages, productLinks, products } from "@/db/schema";
import { readProductImage } from "@/app/api/_lib/product-image";
import { assertLocalMutation, errorResponse, json } from "@/app/api/_lib/http";

const productSchema = z.object({
  title: z.string().trim().min(1).max(300),
  offerId: z.string().trim().min(1, "Укажите артикул продавца.").max(120),
  ozonSku: z.string().trim().min(1, "Укажите SKU Ozon.").max(40),
  removeImage: z.boolean().optional().default(false),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const id = z.string().uuid().parse((await context.params).id);
    let rawBody: unknown;
    let image: Awaited<ReturnType<typeof readProductImage>> = null;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const formData = await request.formData();
      rawBody = {
        title: formData.get("title"),
        offerId: formData.get("offerId"),
        ozonSku: formData.get("ozonSku"),
        removeImage: formData.get("removeImage") === "true",
      };
      image = await readProductImage(formData);
    } else {
      try { rawBody = await request.json(); }
      catch { throw new Error("Тело запроса должно быть корректным JSON."); }
    }
    const body = productSchema.parse(rawBody);

    const result = await db.transaction(async (tx) => {
      const [product] = await tx.select({ id: products.id }).from(products)
        .where(and(eq(products.id, id), eq(products.reassignmentPending, false))).limit(1);
      if (!product) throw new Error("Товар не найден.");

      const links = await tx.select().from(productLinks).where(eq(productLinks.productId, id));
      const identifiers = [
        body.offerId ? eq(productLinks.offerId, body.offerId) : undefined,
        body.ozonSku ? eq(productLinks.ozonSku, body.ozonSku) : undefined,
      ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
      const matchingLinks = identifiers.length
        ? await tx.select().from(productLinks).where(or(...identifiers))
        : [];
      if (matchingLinks.some((link) => link.productId !== id)) {
        throw new Error("Этот артикул или SKU Ozon уже указан у другого товара.");
      }
      const productSku = body.offerId || body.ozonSku;
      const [duplicateProduct] = await tx.select({ id: products.id }).from(products)
        .where(and(eq(products.sku, productSku), eq(products.reassignmentPending, false), ne(products.id, id))).limit(1);
      if (duplicateProduct) throw new Error("Этот артикул или SKU Ozon уже используется другим товаром.");

      await tx.update(products).set({ sku: productSku, title: body.title, updatedAt: new Date() }).where(eq(products.id, id));
      if (links[0]) {
        await tx.update(productLinks).set({ offerId: body.offerId, ozonSku: body.ozonSku }).where(eq(productLinks.id, links[0].id));
      } else {
        await tx.insert(productLinks).values({ productId: id, offerId: body.offerId, ozonSku: body.ozonSku });
      }

      if (image) {
        await tx.insert(productImages).values({ productId: id, ...image })
          .onConflictDoUpdate({ target: productImages.productId, set: { ...image, updatedAt: new Date() } });
      } else if (body.removeImage) {
        await tx.delete(productImages).where(eq(productImages.productId, id));
      }

      const currentImage = !image && !body.removeImage
        ? await tx.select({ productId: productImages.productId }).from(productImages).where(eq(productImages.productId, id)).limit(1)
        : [];
      return {
        id,
        title: body.title,
        offerId: body.offerId,
        ozonSku: body.ozonSku,
        imageUrl: image || currentImage.length
          ? `/api/products/${id}/image`
          : null,
      };
    });

    return Response.json({ item: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const id = z.string().uuid().parse((await context.params).id);
    const force = new URL(request.url).searchParams.get("force") === "true";
    const outcome = await db.transaction(async (tx) => {
      const [product] = await tx.select({ id: products.id, sku: products.sku, title: products.title, reassignmentPending: products.reassignmentPending }).from(products)
        .where(eq(products.id, id)).for("update").limit(1);
      if (!product) return "not-found" as const;
      if (product.reassignmentPending) return "already-pending" as const;

      const [references] = await tx.select({
        purchases: sql<number>`(select count(*)::int from purchases where product_id = ${id})`,
        purchaseReceipts: sql<number>`(select count(*)::int from purchase_receipt_lines where product_id = ${id})`,
        supplies: sql<number>`(select count(*)::int from supply_lines where product_id = ${id})`,
        orders: sql<number>`(select count(*)::int from ozon_posting_items where product_id = ${id})`,
        accruals: sql<number>`(select count(*)::int from ozon_finance_accruals where product_id = ${id})`,
        returns: sql<number>`(select count(*)::int from ozon_returns where product_id = ${id})`,
        manualWriteoffs: sql<number>`(select count(*)::int from manual_writeoffs where product_id = ${id})`,
        ozonWriteoffs: sql<number>`(select count(*)::int from ozon_writeoffs where product_id = ${id})`,
        stocktakes: sql<number>`(select count(*)::int from stocktake_lines where product_id = ${id})`,
        stockAdjustments: sql<number>`(select count(*)::int from stock_adjustments where product_id = ${id})`,
        ozonItems: sql<number>`(select count(*)::int from external_items where product_id = ${id})`,
      }).from(products).where(eq(products.id, id)).limit(1);

      const blockerLabels: Record<string, string> = {
        purchases: "Закупки", purchaseReceipts: "Приёмки закупок", supplies: "Поставки на Ozon",
        orders: "Заказы", accruals: "Денежные операции Ozon", returns: "Возвраты",
        manualWriteoffs: "Списания продавцом", ozonWriteoffs: "Списания Ozon",
        stocktakes: "Инвентаризации", stockAdjustments: "Корректировки остатков", ozonItems: "Связанные записи Ozon",
      };
      const blockers = Object.entries(references ?? {}).map(([key, count]) => ({
        key, label: blockerLabels[key] ?? key, count: Number(count),
      })).filter((item) => item.count > 0);
      if (blockers.length && !force) {
        const [link] = await tx.select().from(productLinks).where(eq(productLinks.productId, id)).limit(1);
        return { kind: "needs-force" as const, product: { id, sku: product.sku, title: product.title, offerId: link?.offerId ?? "", ozonSku: link?.ozonSku ?? "" }, blockers };
      }
      if (blockers.length && force) {
        const [link] = await tx.select().from(productLinks).where(eq(productLinks.productId, id)).limit(1);
        await tx.update(products).set({
          reassignmentPending: true,
          reassignmentOfferId: link?.offerId ?? "",
          reassignmentOzonSku: link?.ozonSku ?? "",
          updatedAt: new Date(),
        }).where(eq(products.id, id));
        await tx.delete(productLinks).where(eq(productLinks.productId, id));
        return { kind: "queued" as const, blockers };
      }
      await tx.update(externalItems).set({ productId: null, disposition: "pending" }).where(eq(externalItems.productId, id));
      await tx.delete(products).where(eq(products.id, id));
      return { kind: "deleted" as const };
    });

    if (outcome === "not-found") return json({ error: "Товар не найден." }, 404);
    if (outcome === "already-pending") return json({ error: "Товар уже находится в списке перераспределения." }, 409);
    if (outcome.kind === "needs-force") return Response.json({ requiresForceDelete: true, ...outcome });
    if (outcome.kind === "queued") return Response.json({ success: true, reassignmentPending: true, blockers: outcome.blockers });
    return json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
