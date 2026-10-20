import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products } from "@/db/schema";
import { assertLocalMutation, errorResponse, parseBody } from "../../_lib/http";

const updateSchema = z.object({ archived: z.boolean() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const { id } = await context.params;
    const body = await parseBody(request, updateSchema);
    const [item] = await db.update(products).set({ archived: body.archived, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    if (!item) throw new Error("Запись не найдена.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}
