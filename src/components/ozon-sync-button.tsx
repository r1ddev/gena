"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { asRecord, requestJson } from "./api";

export function OzonSyncButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function sync() {
    setBusy(true); setMessage("");
    try {
      const response = asRecord(await requestJson("/api/sync", { method: "POST", body: JSON.stringify({ kind: "full" }) }));
      setMessage(typeof response?.message === "string" ? response.message : "Синхронизация поставлена в очередь. Результат будет на главной.");
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось запустить синхронизацию"); }
    finally { setBusy(false); }
  }
  return <><button className="button secondary" onClick={() => void sync()} disabled={busy} title="Запрашивает новые данные у Ozon; обработка выполняется в фоне."><RefreshCw size={14} className={busy ? "spin" : ""} />{busy ? "Запускаем…" : "Синхронизировать с Ozon"}</button>{message && <span className="small-note" role="status">{message}</span>}</>;
}
