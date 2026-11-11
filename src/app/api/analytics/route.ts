import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { handleLocalGet } from "../_lib/http";

function moscowDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const snapshot = await getAccountingSnapshot(userId, new Date(), true, true);
    const ratePoints = snapshot.postingRows.flatMap((posting) => {
      const rate = snapshot.addedCostRateByPostingId?.[posting.id];
      if (!posting.orderDate || rate == null || !Number.isFinite(Number(rate))) return [];
      return [{
        date: moscowDateKey(posting.orderDate),
        timestamp: posting.orderDate.getTime(),
        postingNumber: posting.externalId,
        ratePercent: Number(rate),
      }];
    }).sort((left, right) => left.timestamp - right.timestamp);

    return {
      days: snapshot.dailyTrend.days.map(({ date, sentUnits, purchasedUnits }) => ({ date, sentUnits, purchasedUnits })),
      catalogProducts: snapshot.products.map(({ id, sku, title }) => ({ id, sku, title })),
      productProfitDays: snapshot.productProfitDays ?? [],
      ratePoints,
      availableFrom: snapshot.dailyTrend.days[0]?.date ?? null,
      availableTo: snapshot.dailyTrend.days.at(-1)?.date ?? null,
    };
  });
}
