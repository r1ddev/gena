"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { findRows, getId, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { OzonSyncButton } from "./ozon-sync-button";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";

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
  const [postingNumbers, setPostingNumbers] = useState<Record<string, string>>({});
  const [editingPosting, setEditingPosting] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setRows(findRows(await requestJson("/api/returns")).filter((row) => row.destination !== "ozon")); }
    catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить возвраты"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const refreshAfterSync = () => { void refresh(); };
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    return () => window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
  }, [refresh]);

  async function markReceived(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    setBusyId(id); setError(""); setSuccess("");
    const today = new Date().toISOString();
    try {
      await requestJson(`/api/returns?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ destination: "seller", receivedBySellerAt: today }) });
      setSuccess("Получение записано. Товар добавлен на ваш склад.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить возврат"); }
    finally { setBusyId(""); }
  }

  async function linkPosting(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    const postingNumber = postingNumbers[id]?.trim();
    if (!postingNumber) { setError("Укажи номер отправления Ozon."); return; }
    setBusyId(id); setError(""); setSuccess("");
    try {
      await requestJson(`/api/returns?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ postingNumber }) });
      setPostingNumbers((current) => ({ ...current, [id]: "" }));
      setEditingPosting((current) => ({ ...current, [id]: false }));
      setSuccess("Возврат связан с отправлением. Денежный итог по заказу обновлён.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось связать возврат с отправлением"); }
    finally { setBusyId(""); }
  }

  function editPosting(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    setPostingNumbers((current) => ({ ...current, [id]: String(row.postingNumber ?? "") }));
    setEditingPosting((current) => ({ ...current, [id]: true }));
  }

  return <>
    <PageHeader eyebrow="Обработка возвратов" title="Возвраты" description="Возврат на склад Ozon отображается у заказа и не меняет остатки. Если возврат направлен вам, он попадёт на ваш склад после фактического получения — нажмите «Получил я». Обновите возвраты кнопкой здесь; связанные статусы и суммы загрузятся автоматически." actions={<OzonSyncButton label="Обновить возвраты" completedMessage="Возвраты и связанные с ними статусы и суммы обновлены." />} />
    {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}{success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}
    <section className="panel">
      <div className="panel-head"><div><h2>Возвраты, требующие действия</h2><span className="small-note">{loading ? "Загружаем возвраты…" : `${rows.length} записей`}</span></div><RotateCcw size={17} color="#178b63" /></div>
      {loading ? <div className="panel-body"><div className="loading-line" /></div> : loadError ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={18} /></div><div className="empty-title">Не удалось загрузить возвраты</div><p className="empty-description">{loadError}</p><button className="button secondary" style={{ marginTop: 12 }} onClick={() => void refresh()}>Повторить</button></div></div> : rows.length === 0 ? <div className="empty-state"><div><div className="empty-icon"><RotateCcw size={18} /></div><div className="empty-title">Возвратов, требующих действия, пока нет</div><p className="empty-description">Здесь появятся возвраты, направленные вам, и возвраты с неопределённым местом. Возврат на склад Ozon виден в состоянии заказа и не меняет остаток.</p></div></div> : <div className="table-wrap"><table><thead><tr><th>Возврат</th><th>Товар</th><th>Количество</th><th>Куда</th><th>Статус</th><th>Дата</th><th>Действие</th></tr></thead><tbody>{rows.map((row, index) => {
        const id = getId(row) ?? String(index); const destination = row.destination;
        const sellerDone = destination === "seller" && Boolean(row.receivedBySellerAt);
        const postingMatched = row.postingMatched === true;
        const isEditingPosting = editingPosting[id] === true;
        const postingNumber = String(row.postingNumber ?? "");
        const profitNeedsReconciliation = row.profitReconciliationNeeded === true || (!postingMatched && sellerDone);
        return <tr key={id}><td className="table-primary">{String(row.externalId ?? row.postingNumber ?? id)}</td><td><span className="table-primary">{String(row.title ?? row.productName ?? "—")}</span><span className="table-secondary">{String(row.offerId ?? row.sku ?? row.ozonSku ?? "")}</span></td><td className="number">{String(row.quantity ?? "—")}</td><td>{returnLabel(destination)}</td><td><span className={`badge ${sellerDone ? "green" : "orange"}`}>{sellerDone ? "Получен" : String(row.status ?? "Ожидает подтверждения")}</span>{profitNeedsReconciliation && <span className="badge orange" style={{ marginTop: 5 }}>Прибыль требует сверки</span>}</td><td>{String(row.returnedAt ?? row.updatedAt ?? "—").slice(0, 10)}</td><td><div className="row-actions">{!sellerDone && <button className="button secondary small" disabled={busyId === id} onClick={() => void markReceived(row)}>Получил я</button>}{postingMatched && !isEditingPosting ? <><span className="table-secondary">Отправление {postingNumber}</span><button className="button secondary small" disabled={busyId === id} onClick={() => editPosting(row)}>Изменить связь</button></> : <><input aria-label="Номер отправления Ozon" placeholder={postingNumber ? `Текущий номер: ${postingNumber}` : "Номер отправления"} value={postingNumbers[id] ?? ""} onChange={(event) => setPostingNumbers((current) => ({ ...current, [id]: event.target.value }))} style={{ minWidth: 150, minHeight: 30, padding: "5px 8px", border: "1px solid #dfe5e0", borderRadius: 7, fontSize: 11 }} /><button className="button secondary small" disabled={busyId === id} onClick={() => void linkPosting(row)}>{postingNumber ? "Сохранить связь" : "Связать заказ"}</button>{isEditingPosting && postingMatched && <button className="button secondary small" disabled={busyId === id} onClick={() => setEditingPosting((current) => ({ ...current, [id]: false }))}>Отмена</button>}</>}</div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </>;
}
