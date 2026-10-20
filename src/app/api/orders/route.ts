import { db } from "@/db";
import { appSettings, financeAccruals, postingItems, syncJobs } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { assertLocalMutation, errorResponse, handleLocalGet } from "../_lib/http";

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [snapshot, accruals] = await Promise.all([
      getAccountingSnapshot(),
      db.select().from(financeAccruals),
    ]);
    const itemRows = await db.select().from(postingItems);
    const accrualsByPosting = new Map<string, number>();
    for (const row of accruals) if (row.postingNumber) accrualsByPosting.set(row.postingNumber, (accrualsByPosting.get(row.postingNumber) ?? 0) + Number(row.amount));
    const recognized = new Set(snapshot.recognizedPostingIds);
    return {
      items: snapshot.postingRows.map((posting) => ({
        ...posting,
        items: itemRows.filter((item) => item.postingId === posting.id).map((item) => ({
          title: item.title, offerId: item.offerId, ozonSku: item.ozonSku, quantity: item.quantity, price: item.price, mapped: Boolean(item.productId), isMarketplaceBuyout: item.isMarketplaceBuyout,
        })),
        amount: accrualsByPosting.get(posting.externalId) ?? 0,
        recognized: recognized.has(posting.id),
        phase: (() => {
          const items = itemRows.filter((item) => item.postingId === posting.id);
          if (items.length && items.every((item) => item.isMarketplaceBuyout)) return "Выкуп Ozon";
          if (items.some((item) => item.isMarketplaceBuyout)) return "Смешанная продажа";
          return recognized.has(posting.id) ? "Учтён" : posting.deliveredAt ? "Предварительно" : "Ожидает доставки";
        })(),
      })),
    };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const configuredRows = await db.select().from(appSettings).limit(1);
    const configured = configuredRows[0];
    if (!configured?.ozonClientId || !configured.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
    const [job] = await db.insert(syncJobs).values({ kind: "manual", status: "queued", summary: { requestedBy: "user" } }).returning();
    return Response.json({ item: job, message: "Синхронизация поставлена в очередь." }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
