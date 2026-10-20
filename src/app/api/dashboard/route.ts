import { desc } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, externalItems, syncJobs } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { handle } from "../_lib/http";

export async function GET() {
  return handle(async () => {
    const [snapshot, settingsRows, jobs, externalRows] = await Promise.all([
      getAccountingSnapshot(),
      db.select().from(appSettings).limit(1),
      db.select().from(syncJobs).orderBy(desc(syncJobs.requestedAt)).limit(10),
      db.select().from(externalItems),
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
      unresolvedExternalItems: externalRows.filter((item) => item.disposition === "pending"),
    };
  });
}
