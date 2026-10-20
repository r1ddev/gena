import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productLinks, products } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { assertLocalMutation, errorResponse, handle, parseBody } from "../_lib/http";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().max(120).optional().default("Без категории"),
  offerId: z.string().trim().max(120).optional().default(""),
  ozonSku: z.string().trim().max(40).optional().default(""),
});

export async function GET() {
  return handle(async () => {
    const snapshot = await getAccountingSnapshot();
    const links = await db.select().from(productLinks);
    return {
      items: snapshot.products.map((product) => ({
        ...product,
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
    const body = await parseBody(request, productSchema);
    const result = await db.transaction(async (tx) => {
      const [product] = await tx.insert(products).values({
        sku: body.sku,
        title: body.title,
        category: body.category || "Без категории",
      }).returning();

      if (body.offerId) {
        const conflict = await tx.select().from(productLinks).where(eq(productLinks.offerId, body.offerId));
        const sameOzonSku = conflict.find((link) => (link.ozonSku ?? "") === body.ozonSku);
        if (sameOzonSku) throw new Error("Эти артикул и SKU Ozon уже используются.");
        await tx.insert(productLinks).values({ productId: product.id, offerId: body.offerId, ozonSku: body.ozonSku || null });
      }
      return product;
    });
    return Response.json({ item: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
