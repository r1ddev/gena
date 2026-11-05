import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, ozonPayouts } from "@/db/schema";
import { handleLocalGet } from "../_lib/http";

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [rows, settingsRows] = await Promise.all([
      db.select().from(ozonPayouts).orderBy(desc(ozonPayouts.periodEnd), desc(ozonPayouts.periodBegin)),
      db.select({ accountingStartDate: appSettings.accountingStartDate })
        .from(appSettings)
        .where(eq(appSettings.id, 1))
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
      }));

    return { items };
  });
}
