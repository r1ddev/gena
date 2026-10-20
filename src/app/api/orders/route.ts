import { db } from "@/db";
import { appSettings, financeAccruals, postingItems, syncJobs } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { assertLocalMutation, errorResponse, handle } from "../_lib/http";

export async function GET() {
  return handle(async () => {
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
          title: item.title, offerId: item.offerId, ozonSku: item.ozonSku, quantity: item.quantity, price: item.price, mapped: Boolean(item.productId),
        })),
        amount: accrualsByPosting.get(posting.externalId) ?? 0,
        recognized: recognized.has(posting.id),
        phase: posting.isMarketplaceBuyout ? "Выкуп Ozon" : recognized.has(posting.id) ? "Учтён" : posting.deliveredAt ? "Предварительно" : "Ожидает доставки",
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
