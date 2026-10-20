import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, nonNegativeDecimal } from "../_lib/validation";

const expenseSchema = z.object({
  spentAt: isoDate,
  category: z.string().trim().min(1).max(120),
  amount: nonNegativeDecimal,
  note: z.string().trim().max(2000).optional().default(""),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async () => ({ items: await db.select().from(expenses).orderBy(desc(expenses.spentAt), desc(expenses.createdAt)) }));
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, expenseSchema);
    const [item] = await db.insert(expenses).values(body).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор расхода.");
    const [deleted] = await db.delete(expenses).where(eq(expenses.id, id)).returning({ id: expenses.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
