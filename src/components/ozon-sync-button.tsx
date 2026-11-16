"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { asRecord, findRows, requestJson, type JsonRecord } from "./api";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";

type OzonSyncButtonProps = {
  kind: "orders" | "returns" | "payouts_full";
  label: string;
  completedMessage: string;
};

const pause = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));
type SyncState = "checking" | "idle" | "queued" | "running";
const fullSyncKinds = ["full", "manual", "scheduled"];

function progressCounts(summary: JsonRecord | null) {
  if (!summary || typeof summary.progressCurrent !== "number" || typeof summary.progressTotal !== "number") return null;
  const percent = summary.progressTotal === 0
    ? 100
    : Math.min(100, Math.round(summary.progressCurrent / summary.progressTotal * 100));
  const current = summary.progressCurrent.toLocaleString("ru-RU");
  const total = summary.progressTotal.toLocaleString("ru-RU");
  return { percent, text: `${current} из ${total}` };
}

export function OzonSyncButton({ kind, label, completedMessage }: OzonSyncButtonProps) {
  const [state, setState] = useState<SyncState>("checking");
  const [activeJobId, setActiveJobId] = useState("");
  const [activeJob, setActiveJob] = useState<JsonRecord | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    requestJson("/api/sync").then((value) => {
      if (cancelled) return;
      const activeJob = findRows(value).find((job) =>
        ["queued", "running"].includes(String(job.status))
        && (job.kind === kind || fullSyncKinds.includes(String(job.kind))),
      );
      if (activeJob) {
        setActiveJob(activeJob);
        setActiveJobId(String(activeJob.id ?? ""));
        setState(activeJob.status === "running" ? "running" : "queued");
      } else {
        setState("idle");
      }
    }).catch(() => {
      if (!cancelled) setState("idle");
    });
    return () => { cancelled = true; };
  }, [kind]);

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    async function monitorJob() {
      while (!cancelled) {
        await pause(2500);
        if (cancelled) return;
        let job: JsonRecord | undefined;
        try {
          const jobs = findRows(await requestJson("/api/sync"));
          job = jobs.find((candidate) => candidate.id === activeJobId);
        } catch {
          if (!cancelled) {
            setError(true);
            setMessage("Не удалось проверить статус. Задача продолжает выполняться.");
          }
          continue;
        }
        if (!job || ["queued", "running"].includes(String(job.status))) {
          if (job && !cancelled) {
            setActiveJob(job);
            setError(false);
            setMessage("");
            setState(job.status === "running" ? "running" : "queued");
          }
          continue;
        }

        window.dispatchEvent(new Event(OZON_SYNC_COMPLETED_EVENT));
        setActiveJob(job);
        const summary = asRecord(job.summary);
        const hasPartialFailure = Boolean(job.error) || (Array.isArray(summary?.warnings) && summary.warnings.length > 0);
        if (job.status === "completed") {
          setError(false);
          setMessage(hasPartialFailure ? "Обновление завершено частично. Список обновлён." : completedMessage);
        } else {
          setError(true);
          setMessage("Не удалось обновить данные Ozon. Проверьте настройки подключения и попробуйте ещё раз.");
        }
        setActiveJobId("");
        setState("idle");
      }
    }
    void monitorJob();
    return () => { cancelled = true; };
  }, [activeJobId, completedMessage]);

  async function sync() {
    setState("checking"); setMessage(""); setError(false);
    try {
      const response = asRecord(await requestJson("/api/sync", { method: "POST", body: JSON.stringify({ kind }) }));
      const queuedJob = asRecord(response?.item);
      if (!queuedJob) throw new Error("Не удалось запустить обновление. Проверьте настройки Ozon.");
      const jobId = typeof queuedJob?.id === "string" ? queuedJob.id : "";
      if (!jobId) throw new Error("Не удалось запустить обновление. Проверьте настройки Ozon.");
      setActiveJob(queuedJob);
      setActiveJobId(jobId);
      setState(queuedJob.status === "running" ? "running" : "queued");
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "Не удалось обновить данные Ozon.");
      setState("idle");
    }
  }

  const description = kind === "orders"
    ? "Загружает из Ozon заказы, их статусы и связанные денежные суммы."
    : kind === "returns"
      ? "Загружает из Ozon возвраты, их статусы и связанные денежные суммы."
      : "Загружает отчёты выплат Ozon за весь период учёта.";

  const buttonLabel = state === "checking" ? "Проверяем…" : state === "queued" ? "В очереди…" : state === "running" ? "Синхронизируем…" : label;
  const summary = asRecord(activeJob?.summary);
  const counts = progressCounts(summary);
  const rawProgress = typeof summary?.progress === "string" ? summary.progress : "";
  const currentProgress = counts || rawProgress.startsWith("Загружено ") ? rawProgress : "";
  const progressLabel = currentProgress || "Загружаю данные Ozon";
  const isActive = state === "queued" || state === "running";
  return <div className="ozon-sync-control">
    <button className="button secondary" onClick={() => void sync()} disabled={state !== "idle"} title={description} aria-busy={state === "running"}><RefreshCw size={14} className={state === "running" ? "spin" : ""} />{buttonLabel}</button>
    {isActive && <div className={`sync-progress ${state}`} role="status" aria-live="polite">
      <div className="sync-progress-title"><strong>{state === "queued" ? "Ожидает запуска" : progressLabel}</strong>{counts && <span>{counts.percent}%</span>}</div>
      {state === "running" && <div className={`sync-progress-track${counts ? " determinate" : ""}`} role="progressbar" aria-label="Синхронизация Ozon" aria-valuemin={0} aria-valuemax={100} aria-valuenow={counts?.percent} aria-valuetext={counts ? `${counts.text}, ${counts.percent}%` : progressLabel}><span style={counts ? { width: `${counts.percent}%` } : undefined} /></div>}
      <div className="sync-progress-details">
        {state === "queued" && <span>Запустится автоматически</span>}
        {counts && <span>{counts.text} записей</span>}
      </div>
    </div>}
    {message && <span className="small-note" style={error ? { color: "var(--red)" } : undefined} role={error ? "alert" : "status"}>{message}</span>}
  </div>;
}
