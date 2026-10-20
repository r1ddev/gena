import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, syncJobs } from "@/db/schema";
import { assertLocalMutation, errorResponse, handle } from "../_lib/http";

export async function GET() {
  return handle(async () => ({ items: await db.select().from(syncJobs).orderBy(desc(syncJobs.requestedAt)).limit(30) }));
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    if (!settings?.ozonClientId || !settings.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
    const active = await db.select().from(syncJobs).where(inArray(syncJobs.status, ["queued", "running"])).limit(1);
    if (active[0]) return Response.json({ item: active[0], message: "Синхронизация уже выполняется или ожидает запуска." }, { status: 202 });
    const [item] = await db.insert(syncJobs).values({ kind: "manual", status: "queued", summary: { requestedBy: "user" } }).returning();
    return Response.json({ item, message: "Синхронизация поставлена в очередь." }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
