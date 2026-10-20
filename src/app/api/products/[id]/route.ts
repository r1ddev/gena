import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productImages, productLinks, products } from "@/db/schema";
import { readProductImage } from "@/app/api/_lib/product-image";
import { assertLocalMutation, errorResponse } from "@/app/api/_lib/http";

const productSchema = z.object({
  title: z.string().trim().min(1).max(300),
  offerId: z.string().trim().max(120).optional().default(""),
  ozonSku: z.string().trim().max(40).optional().default(""),
  primaryLinkId: z.string().uuid().optional(),
  removeImage: z.boolean().optional().default(false),
}).refine((body) => body.offerId || body.ozonSku, {
  message: "Укажите артикул или SKU Ozon.",
  path: ["offerId"],
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
        primaryLinkId: formData.get("primaryLinkId") || undefined,
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
      const primaryLink = body.primaryLinkId
        ? links.find((link) => link.id === body.primaryLinkId)
        : links[0];
      if (body.primaryLinkId && !primaryLink) throw new Error("Связь товара с Ozon больше не существует. Обновите каталог и повторите.");
      const duplicateWithinProduct = links.find((link) =>
        link.id !== primaryLink?.id && link.offerId === body.offerId && (link.ozonSku ?? "") === body.ozonSku,
      );
      if (duplicateWithinProduct) throw new Error("Такая пара артикула и SKU Ozon уже есть у этого товара.");

      const duplicateLinks = await tx.select().from(productLinks).where(eq(productLinks.offerId, body.offerId));
      const duplicate = duplicateLinks.find((link) =>
        link.productId !== id && (link.ozonSku ?? "") === body.ozonSku,
      );
      if (duplicate) throw new Error("Эта пара артикула и SKU Ozon уже связана с другим товаром.");
      const productSku = body.offerId || body.ozonSku;
      const [duplicateProduct] = await tx.select({ id: products.id }).from(products)
        .where(and(eq(products.sku, productSku), ne(products.id, id))).limit(1);
      if (duplicateProduct) throw new Error("Этот артикул или SKU Ozon уже используется другим товаром.");

      await tx.update(products).set({ sku: productSku, title: body.title, updatedAt: new Date() }).where(eq(products.id, id));
      if (primaryLink) {
        await tx.update(productLinks).set({ offerId: body.offerId, ozonSku: body.ozonSku || null }).where(eq(productLinks.id, primaryLink.id));
      } else {
        await tx.insert(productLinks).values({ productId: id, offerId: body.offerId, ozonSku: body.ozonSku || null });
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
