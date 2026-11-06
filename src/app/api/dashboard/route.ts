import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, syncJobs } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { handleLocalGet } from "../_lib/http";

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const [snapshot, settingsRows, jobs] = await Promise.all([
      getAccountingSnapshot(userId),
      db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1),
      db.select().from(syncJobs).where(eq(syncJobs.userId, userId)).orderBy(desc(syncJobs.requestedAt)).limit(10),
    ]);
    const settings = settingsRows[0];
    return {
      ...snapshot,
      settings: {
        configured: Boolean(settings?.ozonClientId && settings?.ozonApiKeyEncrypted),
        clientId: settings?.ozonClientId ?? "",
        hasApiKey: Boolean(settings?.ozonApiKeyEncrypted),
        lastSyncAt: settings?.lastSyncAt?.toISOString() ?? null,
        syncIntervalHours: settings?.syncIntervalHours ?? 24,
      },
      syncJobs: jobs,
      unresolvedExternalItems: snapshot.unresolvedExternalItems,
    };
  });
}
