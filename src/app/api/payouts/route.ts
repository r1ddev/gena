import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ozonPayouts } from "@/db/schema";
import { handleLocalGet } from "../_lib/http";

function cents(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function payoutListItem(row: typeof ozonPayouts.$inferSelect) {
  return {
    id: row.externalKey,
    periodBegin: row.periodBegin,
    periodEnd: row.periodEnd,
    currencyCode: row.currencyCode,
    amount: row.amount,
  };
}

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const [row] = await db.select().from(ozonPayouts).where(eq(ozonPayouts.externalKey, id)).limit(1);
      if (!row) throw new Error("Перевод не найден.");
      return { item: payoutListItem(row) };
    }

    const rows = await db.select().from(ozonPayouts)
      .orderBy(desc(ozonPayouts.periodBegin), desc(ozonPayouts.periodEnd));
    return { items: rows.filter((row) => cents(row.amount) !== 0).map(payoutListItem) };
  });
}
