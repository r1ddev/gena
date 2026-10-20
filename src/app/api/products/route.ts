import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productImages, productLinks, products } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { readProductImage } from "../_lib/product-image";
import { assertLocalMutation, errorResponse, handleLocalGet } from "../_lib/http";

const productSchema = z.object({
  title: z.string().trim().min(1).max(300),
  offerId: z.string().trim().max(120).optional().default(""),
  ozonSku: z.string().trim().max(40).optional().default(""),
}).refine((body) => body.offerId || body.ozonSku, {
  message: "Укажите артикул или SKU Ozon.",
  path: ["offerId"],
});

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [snapshot, links, imageRows] = await Promise.all([
      getAccountingSnapshot(),
      db.select().from(productLinks),
      db.select({ productId: productImages.productId }).from(productImages),
    ]);
    const imageProductIds = new Set(imageRows.map(({ productId }) => productId));
    return {
      items: snapshot.products.map(({ archived: _archived, ...product }) => ({
        ...product,
        imageUrl: imageProductIds.has(product.id) ? `/api/products/${product.id}/image` : null,
        offerId: "",
        ozonSku: "",
        ...links.filter((link) => link.productId === product.id).reduce<Record<string, unknown>>((result, link, index) => ({
          ...result,
          ...(index === 0 ? { offerId: link.offerId, ozonSku: link.ozonSku ?? "" } : {}),
          ozonLinks: [...((result.ozonLinks as unknown[] | undefined) ?? []), { offerId: link.offerId, ozonSku: link.ozonSku }],
        }), {}),
      })),
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
      const linked = body.offerId
        ? await tx.select().from(productLinks).where(eq(productLinks.offerId, body.offerId))
        : await tx.select().from(productLinks).where(eq(productLinks.ozonSku, body.ozonSku));
      if (linked.some((link) => link.offerId === body.offerId && (link.ozonSku ?? "") === body.ozonSku)) {
        throw new Error("Этот артикул и SKU Ozon уже есть в каталоге.");
      }

      const [product] = await tx.insert(products).values({
        sku: body.offerId || body.ozonSku,
        title: body.title,
      }).returning({ id: products.id, sku: products.sku, title: products.title, category: products.category, createdAt: products.createdAt, updatedAt: products.updatedAt });

      if (image) await tx.insert(productImages).values({ productId: product.id, ...image });

      if (body.offerId || body.ozonSku) {
        await tx.insert(productLinks).values({ productId: product.id, offerId: body.offerId, ozonSku: body.ozonSku || null });
      }
      return { ...product, imageUrl: image ? `/api/products/${product.id}/image` : null };
    });
    return Response.json({ item: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
