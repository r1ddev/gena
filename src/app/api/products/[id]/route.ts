import { and, eq, exists, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  externalItems,
  financeAccruals,
  manualWriteoffs,
  ozonWriteoffs,
  postingItems,
  productImages,
  productLinks,
  products,
  purchaseReceiptLines,
  purchases,
  returns,
  stockAdjustments,
  stocktakeLines,
  supplyLines,
} from "@/db/schema";
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
      const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1);
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
        .where(and(eq(products.sku, productSku), ne(products.id, id))).limit(1);
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
    const outcome = await db.transaction(async (tx) => {
      const [product] = await tx.select({ id: products.id }).from(products)
        .where(eq(products.id, id)).for("update").limit(1);
      if (!product) return "not-found" as const;

      const [references] = await tx.select({
        purchases: exists(tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.productId, id))),
        purchaseReceipts: exists(tx.select({ id: purchaseReceiptLines.id }).from(purchaseReceiptLines).where(eq(purchaseReceiptLines.productId, id))),
        supplies: exists(tx.select({ id: supplyLines.id }).from(supplyLines).where(eq(supplyLines.productId, id))),
        orders: exists(tx.select({ id: postingItems.id }).from(postingItems).where(eq(postingItems.productId, id))),
        accruals: exists(tx.select({ id: financeAccruals.id }).from(financeAccruals).where(eq(financeAccruals.productId, id))),
        returns: exists(tx.select({ id: returns.id }).from(returns).where(eq(returns.productId, id))),
        manualWriteoffs: exists(tx.select({ id: manualWriteoffs.id }).from(manualWriteoffs).where(eq(manualWriteoffs.productId, id))),
        ozonWriteoffs: exists(tx.select({ id: ozonWriteoffs.id }).from(ozonWriteoffs).where(eq(ozonWriteoffs.productId, id))),
        stocktakes: exists(tx.select({ id: stocktakeLines.id }).from(stocktakeLines).where(eq(stocktakeLines.productId, id))),
        stockAdjustments: exists(tx.select({ id: stockAdjustments.id }).from(stockAdjustments).where(eq(stockAdjustments.productId, id))),
      }).from(products).where(eq(products.id, id)).limit(1);

      if (Object.values(references ?? {}).some(Boolean)) return "in-use" as const;
      await tx.update(externalItems).set({ productId: null, disposition: "pending" }).where(eq(externalItems.productId, id));
      await tx.delete(products).where(eq(products.id, id));
      return "deleted" as const;
    });

    if (outcome === "not-found") return json({ error: "Товар не найден." }, 404);
    if (outcome === "in-use") return json({ error: "Нельзя удалить товар: к нему уже привязаны операции учёта." }, 409);
    return json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
