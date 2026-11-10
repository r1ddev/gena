import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productImages } from "@/db/schema";
import { assertLocalRequest, errorResponse } from "@/app/api/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request);
    const { id } = await context.params;
    const [image] = await db.select().from(productImages).where(eq(productImages.productId, id)).limit(1);
    if (!image) throw new Error("Изображение товара не найдено.");
    return new Response(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.data.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return errorResponse(error); }
}
