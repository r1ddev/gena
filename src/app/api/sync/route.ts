import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, syncJobs } from "@/db/schema";
import { resolveOzonSyncRange } from "@/ozon/sync-range";
import { errorResponse, handleLocalGet, parseBody, requireAuthenticatedMutation } from "../_lib/http";

const syncRequestSchema = z.object({ kind: z.enum(["orders", "returns", "payouts", "payouts_full", "labels", "full"]).default("full") });
const fullSyncKinds = ["full", "manual", "scheduled"];
const payoutSyncKinds = ["payouts", "payouts_full"];
const supplySyncKinds = ["orders", "returns", "labels", "full"];

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const [active, recent] = await Promise.all([
      db.select().from(syncJobs).where(and(eq(syncJobs.userId, userId), inArray(syncJobs.status, ["queued", "running"]))),
      db.select().from(syncJobs).where(eq(syncJobs.userId, userId)).orderBy(desc(syncJobs.requestedAt)).limit(30),
    ]);
    const items = [...new Map([...active, ...recent].map((item) => [item.id, item])).values()]
      .sort((first, second) => second.requestedAt.getTime() - first.requestedAt.getTime());
    return { items };
  });
}

export async function POST(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const { kind } = await parseBody(request, syncRequestSchema);
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
    if (!settings?.ozonClientId || !settings.ozonApiKeyEncrypted) throw new Error("Сначала укажи Client ID и API-ключ Ozon в настройках.");
    if (!settings.accountingStartDate) throw new Error("Сначала укажи дату начала учёта в настройках.");
    const active = await db.select().from(syncJobs).where(and(eq(syncJobs.userId, userId), inArray(syncJobs.status, ["queued", "running"])));
    const conflictingJob = active.find((job) => job.kind === kind
      || (payoutSyncKinds.includes(job.kind) && payoutSyncKinds.includes(kind))
      || (supplySyncKinds.includes(job.kind) && supplySyncKinds.includes(kind))
      || fullSyncKinds.includes(job.kind)
      || kind === "full");
    if (conflictingJob) {
      return Response.json({ item: conflictingJob, message: "Обновление уже выполняется или ожидает запуска." }, { status: 202 });
    }
    const requestedAt = new Date();
    const range = resolveOzonSyncRange(settings.accountingStartDate, settings.lastSyncAt, requestedAt);
    const queriedFrom = kind === "payouts_full" ? new Date(`${settings.accountingStartDate}T00:00:00.000Z`) : range.from;
    const [item] = await db.insert(syncJobs).values({
      userId,
      kind,
      status: "queued",
      summary: {
        requestedBy: "user",
        accountingStartDate: settings.accountingStartDate,
        queriedFrom: queriedFrom.toISOString(),
        queriedTo: range.to.toISOString(),
        progress: "Ожидает запуска",
      },
    }).returning();
    return Response.json({ item, message: "Синхронизация поставлена в очередь." }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
