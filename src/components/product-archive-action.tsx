"use client";

import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { getId, requestJson, type JsonRecord } from "./api";

export function ProductArchiveAction({ row, refresh }: { row: JsonRecord; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = getId(row);
  const archived = row.archived === true;
  async function toggle() {
    if (!id) return;
    setBusy(true); setError("");
    try { await requestJson(`/api/products?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ archived: !archived }) }); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить статус товара"); }
    finally { setBusy(false); }
  }
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{error && <span className="small-note" role="alert" title={error}>Ошибка</span>}<button type="button" className="button secondary small" aria-label={archived ? "Вернуть товар в каталог" : "Архивировать товар"} title={archived ? "Вернуть в каталог" : "В архив"} disabled={busy || !id} onClick={() => void toggle()}>{archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{archived ? "Восстановить" : "В архив"}</button></span>;
}
