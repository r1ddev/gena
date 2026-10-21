"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { asRecord, findRows, requestJson, type JsonRecord } from "./api";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";

type OzonSyncButtonProps = {
  kind: "orders" | "returns";
  label: string;
  completedMessage: string;
};

const pause = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

export function OzonSyncButton({ kind, label, completedMessage }: OzonSyncButtonProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function sync() {
    setBusy(true); setMessage(""); setError(false);
    try {
      const response = asRecord(await requestJson("/api/sync", { method: "POST", body: JSON.stringify({ kind }) }));
      const queuedJob = asRecord(response?.item);
      if (!queuedJob) throw new Error("Не удалось запустить обновление. Проверьте настройки Ozon.");
      const jobId = typeof queuedJob?.id === "string" ? queuedJob.id : "";
      if (!jobId) throw new Error("Не удалось запустить обновление. Проверьте настройки Ozon.");

      let job: JsonRecord = queuedJob;
      const deadline = Date.now() + 30 * 60 * 1000;
      while (["queued", "running"].includes(String(job.status))) {
        if (Date.now() >= deadline) throw new Error("Обновление ещё выполняется. Откройте раздел снова, чтобы увидеть актуальные данные.");
        await pause(2500);
        const jobs = findRows(await requestJson("/api/sync"));
        job = jobs.find((candidate) => candidate.id === jobId) ?? job;
      }

      window.dispatchEvent(new Event(OZON_SYNC_COMPLETED_EVENT));
      const summary = asRecord(job.summary);
      const hasPartialFailure = Boolean(job.error) || (Array.isArray(summary?.warnings) && summary.warnings.length > 0);
      if (job.status === "completed") {
        setMessage(hasPartialFailure ? "Обновление завершено частично. Список обновлён." : completedMessage);
      } else {
        setError(true);
        setMessage("Не удалось обновить данные Ozon. Проверьте настройки подключения и попробуйте ещё раз.");
      }
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "Не удалось обновить данные Ozon.");
    } finally { setBusy(false); }
  }

  const description = kind === "orders"
    ? "Загружает из Ozon заказы, их статусы и связанные денежные суммы."
    : "Загружает из Ozon возвраты, их статусы и связанные денежные суммы.";

  return <><button className="button secondary" onClick={() => void sync()} disabled={busy} title={description}><RefreshCw size={14} className={busy ? "spin" : ""} />{busy ? "Синхронизируем…" : label}</button>{message && <span className="small-note" style={error ? { color: "var(--red)" } : undefined} role={error ? "alert" : "status"}>{message}</span>}</>;
}
