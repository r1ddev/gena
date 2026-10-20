"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { requestJson } from "./api";

export function RefreshSalesButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function sync() {
    setBusy(true); setMessage("");
    try { await requestJson("/api/sync", { method: "POST", body: JSON.stringify({ kind: "full" }) }); setMessage("Обновление запущено"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось обновить"); }
    finally { setBusy(false); }
  }
  return <><button className="button secondary" onClick={() => void sync()} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} />{busy ? "Запускаем…" : "Синхронизировать"}</button>{message && <span className="small-note" role="status">{message}</span>}</>;
}
