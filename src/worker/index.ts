import { and, desc, eq, inArray } from "drizzle-orm";
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
  const settingsRows = await db.select().from(appSettings);
  for (const settings of settingsRows) {
    if (!settings.ozonClientId || !settings.ozonApiKeyEncrypted) continue;
    const [activeJobs, latestScheduled] = await Promise.all([
      db.select({ id: syncJobs.id }).from(syncJobs)
        .where(and(eq(syncJobs.userId, settings.userId), inArray(syncJobs.status, ["queued", "running"])))
        .limit(1),
      db.select().from(syncJobs)
        .where(and(eq(syncJobs.userId, settings.userId), eq(syncJobs.kind, "scheduled")))
        .orderBy(desc(syncJobs.requestedAt))
        .limit(1),
    ]);
    if (activeJobs.length) continue;
    const intervalMs = Math.max(1, settings.syncIntervalHours) * 60 * 60 * 1000;
    const latestRequest = latestScheduled[0]?.requestedAt;
    const baseline = !settings.lastSyncAt || (latestRequest && latestRequest > settings.lastSyncAt) ? latestRequest : settings.lastSyncAt;
    if (baseline && now.getTime() - baseline.getTime() < intervalMs) continue;
    const [job] = await db.insert(syncJobs)
      .values({ userId: settings.userId, kind: "scheduled", status: "queued", summary: { intervalHours: settings.syncIntervalHours } })
      .returning({ id: syncJobs.id });
    if (job) process.stdout.write(`Scheduled sync queued (${settings.syncIntervalHours}h interval).\n`);
  }
}

async function processJob() {
  if (working) return;
  working = true;
  try {
    const job = await claimNextJob();
    if (!job) return;
    const startedAt = Date.now();
    process.stdout.write(`Sync job ${job.id} started.\n`);
    try {
      const summary = await syncOzonData(job.userId, job.id);
      const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
      await db.update(syncJobs).set({ status: "completed", finishedAt: new Date(), heartbeatAt: new Date(), summary, error: warnings.length ? warnings.join("\n") : null }).where(and(eq(syncJobs.userId, job.userId), eq(syncJobs.id, job.id)));
      process.stdout.write(`Sync job ${job.id} completed in ${Math.round((Date.now() - startedAt) / 1000)}s${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(syncJobs).set({ status: "failed", finishedAt: new Date(), heartbeatAt: new Date(), error: message }).where(and(eq(syncJobs.userId, job.userId), eq(syncJobs.id, job.id)));
      process.stderr.write(`Sync job ${job.id} failed: ${message}\n`);
    }
  } finally {
    working = false;
  }
}

async function failInterruptedSyncJobs() {
  const now = new Date();
  const interrupted = await db.select({ id: syncJobs.id, userId: syncJobs.userId })
    .from(syncJobs).where(eq(syncJobs.status, "running"));
  for (const job of interrupted) {
    await db.update(syncJobs)
      .set({ status: "failed", finishedAt: now, heartbeatAt: now, error: "Синхронизация прервана при остановке фонового процесса." })
      .where(and(eq(syncJobs.id, job.id), eq(syncJobs.userId, job.userId)));
  }
  if (interrupted.length) process.stderr.write(`Marked ${interrupted.length} interrupted sync job(s) as failed.\n`);
}

async function run() {
  process.stdout.write(`Worker started (${timezone}); checks the sync schedule every 30 seconds.\n`);
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
