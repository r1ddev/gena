import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productImages, productLinks, products } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { readProductImage } from "../_lib/product-image";
import { assertLocalMutation, errorResponse, handleLocalGet } from "../_lib/http";

const productSchema = z.object({
  title: z.string().trim().min(1).max(300),
  offerId: z.string().trim().min(1, "Укажите артикул продавца.").max(120),
  ozonSku: z.string().trim().min(1, "Укажите SKU Ozon.").max(40),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [snapshot, links, imageRows] = await Promise.all([
      getAccountingSnapshot(),
      db.select().from(productLinks),
      db.select({ productId: productImages.productId }).from(productImages),
    ]);
    const imageProductIds = new Set(imageRows.map(({ productId }) => productId));
    const linkByProductId = new Map(links.map((link) => [link.productId, link]));
    return {
      items: snapshot.products.map(({ archived: _archived, ...product }) => {
        const link = linkByProductId.get(product.id);
        return {
          ...product,
          imageUrl: imageProductIds.has(product.id) ? `/api/products/${product.id}/image` : null,
          offerId: link?.offerId ?? "",
          ozonSku: link?.ozonSku ?? "",
        };
      }),
    };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    let rawBody: unknown;
    let image: Awaited<ReturnType<typeof readProductImage>> = null;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const formData = await request.formData();
      rawBody = { title: formData.get("title"), offerId: formData.get("offerId"), ozonSku: formData.get("ozonSku") };
      image = await readProductImage(formData);
    } else {
      try { rawBody = await request.json(); }
      catch { throw new Error("Тело запроса должно быть корректным JSON."); }
    }
    const body = productSchema.parse(rawBody);
    const result = await db.transaction(async (tx) => {
      const identifiers = [
        body.offerId ? eq(productLinks.offerId, body.offerId) : undefined,
        body.ozonSku ? eq(productLinks.ozonSku, body.ozonSku) : undefined,
      ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
      const linked = identifiers.length
        ? await tx.select().from(productLinks).where(or(...identifiers))
        : [];
      if (linked.length) throw new Error("Этот артикул или SKU Ozon уже указан у другого товара.");

      const [product] = await tx.insert(products).values({
        sku: body.offerId || body.ozonSku,
        title: body.title,
      }).returning({ id: products.id, sku: products.sku, title: products.title, category: products.category, createdAt: products.createdAt, updatedAt: products.updatedAt });

      if (image) await tx.insert(productImages).values({ productId: product.id, ...image });

      if (body.offerId || body.ozonSku) {
        await tx.insert(productLinks).values({ productId: product.id, offerId: body.offerId, ozonSku: body.ozonSku });
      }
      return { ...product, imageUrl: image ? `/api/products/${product.id}/image` : null };
    });
    return Response.json({ item: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
