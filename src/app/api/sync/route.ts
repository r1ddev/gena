import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, syncJobs } from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";

const syncRequestSchema = z.object({ kind: z.enum(["orders", "returns", "full"]).default("full") });

export async function GET(request: Request) {
  return handleLocalGet(request, async () => ({ items: await db.select().from(syncJobs).orderBy(desc(syncJobs.requestedAt)).limit(30) }));
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const { kind } = await parseBody(request, syncRequestSchema);
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    if (!settings?.ozonClientId || !settings.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
    if (!settings.accountingStartDate) throw new Error("Сначала укажи дату начала учёта в настройках.");
    const active = await db.select().from(syncJobs).where(inArray(syncJobs.status, ["queued", "running"]));
    const conflictingJob = kind === "full" ? active[0] : active.find((job) => job.kind === kind);
    if (conflictingJob) {
      return Response.json({ item: conflictingJob, message: "Обновление уже выполняется или ожидает запуска." }, { status: 202 });
    }
    const [item] = await db.insert(syncJobs).values({ kind, status: "queued", summary: { requestedBy: "user" } }).returning();
    return Response.json({ item, message: "Синхронизация поставлена в очередь." }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
