import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, ozonPayouts } from "@/db/schema";
import { errorResponse, handleLocalGet, parseBody, requireAuthenticatedMutation } from "../_lib/http";

const payoutUpdateSchema = z.object({ excludedFromAccounting: z.boolean() });

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const [rows, settingsRows] = await Promise.all([
      db.select().from(ozonPayouts).where(eq(ozonPayouts.userId, userId)).orderBy(desc(ozonPayouts.periodEnd), desc(ozonPayouts.periodBegin)),
      db.select({ accountingStartDate: appSettings.accountingStartDate })
        .from(appSettings)
        .where(eq(appSettings.userId, userId))
        .limit(1),
    ]);
    const accountingStartDate = settingsRows[0]?.accountingStartDate ?? "0000-01-01";
    const items = rows
      .filter((payout) => Number(payout.amount) !== 0 && payout.periodEnd >= accountingStartDate)
      .map((payout) => ({
        id: payout.id,
        periodBegin: payout.periodBegin,
        periodEnd: payout.periodEnd,
        currencyCode: payout.currencyCode,
        amount: payout.amount,
        excludedFromAccounting: payout.excludedFromAccounting,
      }));

    return { items };
  });
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор выплаты.");
    const body = await parseBody(request, payoutUpdateSchema);
    const [item] = await db.update(ozonPayouts)
      .set({ excludedFromAccounting: body.excludedFromAccounting, updatedAt: new Date() })
      .where(and(eq(ozonPayouts.id, id), eq(ozonPayouts.userId, userId)))
      .returning({ id: ozonPayouts.id, excludedFromAccounting: ozonPayouts.excludedFromAccounting });
    if (!item) throw new Error("Выплата не найдена.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}
