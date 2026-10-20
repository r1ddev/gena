"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw, RotateCcw } from "lucide-react";
import { findRows, getId, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";

function returnLabel(value: unknown) {
  const labels: Record<string, string> = { seller: "Мне", ozon: "На склад Ozon", unknown: "Не определено" };
  return typeof value === "string" ? labels[value] ?? value : "—";
}

export function ReturnsWorkspace() {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setRows(findRows(await requestJson("/api/returns"))); }
    catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить возвраты"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function update(row: JsonRecord, destination: "seller" | "ozon") {
    const id = getId(row); if (!id) return;
    setBusyId(id); setError(""); setSuccess("");
    const today = new Date().toISOString();
    const body = destination === "seller" ? { destination, receivedBySellerAt: today } : { destination, availableAtOzon: today };
    try {
      await requestJson(`/api/returns?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      setSuccess(destination === "seller" ? "Возврат отмечен как фактически полученный. Остаток продавца пересчитан." : "Возврат отмечен как доступный к продаже на Ozon. Остаток пересчитан.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить возврат"); }
    finally { setBusyId(""); }
  }

  return <>
    <PageHeader eyebrow="Обработка возвратов" title="Возвраты" description="Возврат на Ozon добавляется в остаток, когда товар снова доступен к продаже. Возврат вам попадёт на ваш склад только после фактического получения." actions={<button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} />Обновить список</button>} />
    {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}{success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}
    <section className="panel">
      <div className="panel-head"><div><h2>Возвраты из Ozon</h2><span className="small-note">{loading ? "Обновляем…" : `${rows.length} записей`}</span></div><RotateCcw size={17} color="#178b63" /></div>
      {loading ? <div className="panel-body"><div className="loading-line" /></div> : loadError ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={18} /></div><div className="empty-title">Не удалось загрузить возвраты</div><p className="empty-description">{loadError}</p><button className="button secondary" style={{ marginTop: 12 }} onClick={() => void refresh()}>Повторить</button></div></div> : rows.length === 0 ? <div className="empty-state"><div><div className="empty-icon"><RotateCcw size={18} /></div><div className="empty-title">Возвратов пока нет</div><p className="empty-description">Возвраты появятся после синхронизации данных Ozon.</p></div></div> : <div className="table-wrap"><table><thead><tr><th>Возврат</th><th>Товар</th><th>Количество</th><th>Куда</th><th>Статус</th><th>Дата</th><th>Действие</th></tr></thead><tbody>{rows.map((row, index) => {
        const id = getId(row) ?? String(index); const destination = row.destination;
        const sellerDone = destination === "seller" && Boolean(row.receivedBySellerAt);
        const ozonDone = destination === "ozon" && Boolean(row.availableAtOzon);
        return <tr key={id}><td className="table-primary">{String(row.externalId ?? row.postingNumber ?? id)}</td><td><span className="table-primary">{String(row.title ?? row.productName ?? "—")}</span><span className="table-secondary">{String(row.offerId ?? row.sku ?? row.ozonSku ?? "")}</span></td><td className="number">{String(row.quantity ?? "—")}</td><td>{returnLabel(destination)}</td><td><span className={`badge ${sellerDone || ozonDone ? "green" : "orange"}`}>{sellerDone ? "Получен" : ozonDone ? "Доступен" : String(row.status ?? "Ожидает подтверждения")}</span></td><td>{String(row.returnedAt ?? row.updatedAt ?? "—").slice(0, 10)}</td><td><div className="row-actions">{!sellerDone && <button className="button secondary small" disabled={busyId === id} onClick={() => void update(row, "seller")}>Получил я</button>}{!ozonDone && <button className="button secondary small" disabled={busyId === id} onClick={() => void update(row, "ozon")}>Снова в продаже</button>}</div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </>;
}
