import { desc, eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { appSettings, syncJobs } from "@/db/schema";
import { makeDailyBackup } from "./backup";
import { claimNextJob, syncOzonData } from "./sync";

const timezone = process.env.APP_TIMEZONE ?? "Europe/Moscow";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
let working = false;

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { day: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

async function enqueueScheduledSync(now = new Date()) {
  const [settingsRows, activeJobs, latestScheduled] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1),
    db.select({ id: syncJobs.id }).from(syncJobs).where(inArray(syncJobs.status, ["queued", "running"])).limit(1),
    db.select().from(syncJobs).where(eq(syncJobs.kind, "scheduled")).orderBy(desc(syncJobs.requestedAt)).limit(1),
  ]);
  const settings = settingsRows[0];
  if (!settings?.ozonClientId || !settings.ozonApiKeyEncrypted || activeJobs.length) return;
  const intervalMs = Math.max(1, settings.syncIntervalHours) * 60 * 60 * 1000;
  const latestRequest = latestScheduled[0]?.requestedAt;
  const baseline = !settings.lastSyncAt || (latestRequest && latestRequest > settings.lastSyncAt) ? latestRequest : settings.lastSyncAt;
  if (baseline && now.getTime() - baseline.getTime() < intervalMs) return;
  await db.insert(syncJobs).values({ kind: "scheduled", status: "queued", summary: { intervalHours: settings.syncIntervalHours } });
}

async function processJob() {
  if (working) return;
  working = true;
  try {
    const jobId = await claimNextJob();
    if (!jobId) return;
    try {
      const summary = await syncOzonData(jobId);
      const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
      await db.update(syncJobs).set({ status: "completed", finishedAt: new Date(), heartbeatAt: new Date(), summary, error: warnings.length ? warnings.join("\n") : null }).where(eq(syncJobs.id, jobId));
    } catch (error) {
      await db.update(syncJobs).set({ status: "failed", finishedAt: new Date(), heartbeatAt: new Date(), error: error instanceof Error ? error.message : String(error) }).where(eq(syncJobs.id, jobId));
    }
  } finally {
    working = false;
  }
}

async function failInterruptedSyncJobs() {
  const now = new Date();
  const interrupted = await db.update(syncJobs)
    .set({ status: "failed", finishedAt: now, heartbeatAt: now, error: "Синхронизация прервана при остановке фонового процесса." })
    .where(eq(syncJobs.status, "running"))
    .returning({ id: syncJobs.id });
  if (interrupted.length) process.stderr.write(`Marked ${interrupted.length} interrupted sync job(s) as failed.\n`);
}

async function run() {
  process.stdout.write(`Worker started (${timezone}).\n`);
  await failInterruptedSyncJobs();
  while (!stopping) {
    const { day, hour } = zonedParts();
    if (hour >= 3) {
      try {
        await makeDailyBackup(day);
      } catch (error) {
        process.stderr.write(`Daily backup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    try {
      await enqueueScheduledSync();
      await processJob();
    } catch (error) {
      process.stderr.write(`Sync worker loop error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await delay(30_000);
  }
  await pool.end();
}

process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

run().catch((error) => {
  process.stderr.write(`Worker stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
