import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productLinks, products } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";

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
    const snapshot = await getAccountingSnapshot();
    const links = await db.select().from(productLinks);
    return {
      items: snapshot.products.map((product) => ({
        ...product,
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
    const body = await parseBody(request, productSchema);
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
      }).returning();

      if (body.offerId || body.ozonSku) {
        await tx.insert(productLinks).values({ productId: product.id, offerId: body.offerId, ozonSku: body.ozonSku || null });
      }
      return product;
    });
    return Response.json({ item: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
