"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, Plus, RefreshCw, Trash2 } from "lucide-react";
import { findRows, getId, localToday, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";

type ProductOption = { id: string; label: string };

export function StocktakeWorkspace() {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [warehouse, setWarehouse] = useState("seller");
  const [countedAt, setCountedAt] = useState(localToday());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ productId: "", actualQuantity: "" }]);
  const [busy, setBusy] = useState(false);
  const [busyLine, setBusyLine] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setRows(findRows(await requestJson("/api/stocktakes"))); }
    catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить инвентаризации"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); requestJson("/api/products").then((value) => setProducts(findRows(value).map((row) => {
    const id = getId(row); if (!id) return null; const sku = typeof row.sku === "string" ? row.sku : ""; return { id, label: sku ? `${String(row.title ?? "Товар")} · ${sku}` : String(row.title ?? "Товар") };
  }).filter((item): item is ProductOption => item !== null))).catch(() => setProducts([])); }, [refresh]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson("/api/stocktakes", { method: "POST", body: JSON.stringify({ warehouse, countedAt, note, lines: lines.map((line) => ({ productId: line.productId, actualQuantity: Number(line.actualQuantity) })) }) });
      setLines([{ productId: "", actualQuantity: "" }]); setNote(""); setSuccess("Инвентаризация записана. Найденные расхождения ожидают отдельного разбора."); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось записать инвентаризацию"); }
    finally { setBusy(false); }
  }

  async function resolve(line: JsonRecord) {
    const id = getId(line); if (!id) return;
    setBusyLine(id); setError(""); setSuccess("");
    try { await requestJson(`/api/stocktakes?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ resolutionNote: "Подтверждено при разборе инвентаризации" }) }); setSuccess("Расхождение подтверждено, остатки пересчитаны."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось подтвердить расхождение"); }
    finally { setBusyLine(""); }
  }

  async function removeStocktake(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    if (typeof window !== "undefined" && !window.confirm("Удалить инвентаризацию целиком? Её корректировки также будут отменены.")) return;
    setBusy(true); setError(""); setSuccess("");
    try { await requestJson(`/api/stocktakes?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setSuccess("Инвентаризация удалена. Остатки пересчитаны."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить инвентаризацию"); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeader eyebrow="Контроль остатков" title="Инвентаризация" description="Запишите фактическое количество по каждому товару. Расхождение не изменяет остаток, пока вы не разберёте и не подтвердите его отдельно." actions={<button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} />Обновить</button>} />
    {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}{success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}
    <section className="panel form-panel">
      <div className="panel-head"><h2>Новый пересчёт</h2><ClipboardList size={17} color="#178b63" /></div>
      <form className="panel-body" onSubmit={create}>
        <div className="form-grid">
          <div className="field"><label htmlFor="stocktake-warehouse">Склад *</label><select id="stocktake-warehouse" value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option value="seller">Мой склад</option><option value="ozon">Склад Ozon</option></select></div>
          <div className="field"><label htmlFor="stocktake-date">Дата пересчёта *</label><input id="stocktake-date" type="date" required value={countedAt} onChange={(event) => setCountedAt(event.target.value)} /></div>
          <div className="field wide"><label htmlFor="stocktake-note">Комментарий</label><input id="stocktake-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <div className="form-help" style={{ marginBottom: 8, color: "#5f6d64", fontWeight: 700 }}>Фактические остатки</div>
        <div className="line-items">{lines.map((line, index) => <div className="line-item" key={index}>
          <div className="field"><label htmlFor={`stock-product-${index}`}>Товар *</label><select id={`stock-product-${index}`} required value={line.productId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, productId: event.target.value } : item))}><option value="">Выберите товар…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}</select></div>
          <div className="field"><label htmlFor={`stock-actual-${index}`}>Фактически *</label><input id={`stock-actual-${index}`} type="number" min="0" step="0.001" required value={line.actualQuantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, actualQuantity: event.target.value } : item))} /></div>
          <button type="button" className="icon-button" aria-label="Удалить товар из пересчёта" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><Trash2 size={14} /></button>
        </div>)}</div>
        <div className="form-actions" style={{ justifyContent: "space-between" }}><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, { productId: "", actualQuantity: "" }])}><Plus size={14} />Добавить товар</button><button className="button" disabled={busy || products.length === 0}>{busy ? "Сохраняем…" : "Записать инвентаризацию"}</button></div>
      </form>
    </section>

    <section className="panel">
      <div className="panel-head"><div><h2>История и расхождения</h2><span className="small-note">{loading ? "Обновляем…" : `${rows.length} пересчётов`}</span></div><RefreshCw size={16} color="#829087" /></div>
      {loading ? <div className="panel-body"><div className="loading-line" /></div> : loadError ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={18} /></div><div className="empty-title">Не удалось загрузить историю</div><p className="empty-description">{loadError}</p></div></div> : rows.length === 0 ? <div className="empty-state"><div><div className="empty-icon"><ClipboardList size={18} /></div><div className="empty-title">Пока нет инвентаризаций</div><p className="empty-description">Создайте первый пересчёт выше.</p></div></div> : <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Склад</th><th>Товар</th><th>Ожидалось</th><th>Фактически</th><th>Расхождение</th><th>Решение</th></tr></thead><tbody>{rows.flatMap((row, rowIndex) => {
        const linesForRow = Array.isArray(row.lines) ? row.lines.map((value) => value as JsonRecord) : [row];
        return linesForRow.map((line, index) => { const lineId = getId(line) ?? `${rowIndex}-${index}`; const expected = Number(line.expectedQuantity ?? 0); const actual = Number(line.actualQuantity ?? 0); const difference = actual - expected; const resolved = Boolean(line.resolvedAt ?? line.resolutionNote); return <tr key={lineId}><td>{String(row.countedAt ?? line.countedAt ?? "—").slice(0, 10)}</td><td>{row.warehouse === "ozon" ? "Ozon" : "Мой склад"}</td><td><span className="table-primary">{String(line.title ?? row.title ?? "—")}</span><span className="table-secondary">{String(line.sku ?? row.sku ?? "")}</span></td><td className="number">{String(line.expectedQuantity ?? "—")}</td><td className="number">{String(line.actualQuantity ?? "—")}</td><td><span className={`badge ${difference === 0 ? "green" : "orange"}`}>{difference > 0 ? "+" : ""}{Number.isFinite(difference) ? difference : "—"}</span></td><td><div className="row-actions">{resolved ? <span className="badge green">Разобрано</span> : <button className="button secondary small" disabled={busyLine === lineId} onClick={() => void resolve(line)}>Принять факт</button>}{index === 0 && <button className="icon-button" aria-label="Удалить всю инвентаризацию" title="Удалить инвентаризацию" disabled={busy} onClick={() => void removeStocktake(row)}><Trash2 size={14} /></button>}</div></td></tr>; });
      })}</tbody></table></div>}
    </section>
  </>;
}
