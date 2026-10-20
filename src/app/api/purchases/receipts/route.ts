import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { purchaseReceipts, purchases } from "@/db/schema";
import { assertLocalMutation, errorResponse, parseBody } from "../../_lib/http";
import { isoDate, nonNegativeDecimal, positiveDecimal } from "../../_lib/validation";

const receiptSchema = z.object({
  purchaseId: z.string().uuid(),
  receivedAt: isoDate,
  receivedQuantity: positiveDecimal,
  unitCost: nonNegativeDecimal,
  note: z.string().trim().max(2000).optional().default(""),
});

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, receiptSchema);
    const purchase = (await db.select().from(purchases).where(eq(purchases.id, body.purchaseId)).limit(1))[0];
    if (!purchase) throw new Error("Закупка не найдена.");
    const [item] = await db.insert(purchaseReceipts).values(body).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
