"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, Plus, RefreshCw, Trash2 } from "lucide-react";
import { findRows, getId, localToday, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { filterAndSortRows, TableEmptyRow, TableHead, type TableColumn, type TableSort } from "./table-controls";

type ProductOption = { id: string; label: string };
type StocktakeTableRow = JsonRecord & { header: JsonRecord; line: JsonRecord; lineIndex: number; difference: number };

const stocktakeColumns: TableColumn<StocktakeTableRow>[] = [
  { key: "countedAt", label: "Дата", kind: "date" },
  { key: "warehouseLabel", label: "Склад" },
  { key: "product", label: "Товар", value: (row) => [row.title, row.sku, row.resolutionNote].filter(Boolean).join(" ") },
  { key: "expectedQuantity", label: "Ожидалось", kind: "quantity" },
  { key: "actualQuantity", label: "Фактически", kind: "quantity" },
  { key: "difference", label: "Расхождение", kind: "quantity" },
  { key: "resolutionStatus", label: "Решение" },
];

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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<TableSort>(null);

  const tableRows = useMemo(() => rows.flatMap((row) => {
    const linesForRow = Array.isArray(row.lines) ? row.lines.map((value) => value as JsonRecord) : [row];
    return linesForRow.map((line, lineIndex): StocktakeTableRow => {
      const expected = Number(line.expectedQuantity ?? 0);
      const actual = Number(line.actualQuantity ?? 0);
      const resolutionNote = String(line.resolutionNote ?? "");
      const needsReview = resolutionNote.startsWith("НУЖНА СВЕРКА:");
      const resolved = Boolean(line.resolvedAt);
      return {
        ...line,
        id: getId(line) ?? `${getId(row) ?? "stocktake"}-${lineIndex}`,
        header: row,
        line,
        lineIndex,
        countedAt: row.countedAt ?? line.countedAt,
        warehouseLabel: row.warehouse === "ozon" ? "Ozon" : "Мой склад",
        title: line.title ?? row.title ?? "—",
        sku: line.sku ?? row.sku ?? "",
        difference: actual - expected,
        resolutionStatus: needsReview ? `НУЖНА СВЕРКА ${resolutionNote}` : resolved ? "Разобрано" : "Ожидает разбора",
      };
    });
  }), [rows]);
  const visibleRows = useMemo(() => filterAndSortRows(tableRows, stocktakeColumns, filters, sort), [tableRows, filters, sort]);
  const hasActiveFilters = Object.values(filters).some((value) => value.trim());

  function updateSort(key: string) {
    setSort((current) => ({ key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

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
    try { await requestJson(`/api/stocktakes?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ resolutionNote: "Подтверждено при разборе инвентаризации" }) }); setSuccess("Расхождение подтверждено. Остатки обновлены."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось подтвердить расхождение"); }
    finally { setBusyLine(""); }
  }

  async function removeStocktake(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    if (typeof window !== "undefined" && !window.confirm("Удалить инвентаризацию целиком? Её корректировки также будут отменены.")) return;
    setBusy(true); setError(""); setSuccess("");
    try { await requestJson(`/api/stocktakes?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setSuccess("Инвентаризация удалена. Остатки обновлены."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить инвентаризацию"); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeader eyebrow="Контроль остатков" title="Инвентаризация" description="Запишите фактическое количество по каждому товару. Расхождение не изменяет остаток, пока вы не разберёте и не подтвердите его отдельно." />
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
      <div className="panel-head"><div><h2>История и расхождения</h2><span className="small-note">{loading ? "Загружаем…" : `${rows.length} пересчётов · ${visibleRows.length} строк`}</span></div><RefreshCw size={16} color="#829087" /></div>
      {loading && rows.length === 0 && !hasActiveFilters ? <div className="panel-body"><div className="loading-line" /></div> : loadError && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={18} /></div><div className="empty-title">Не удалось загрузить историю</div><p className="empty-description">{loadError}</p></div></div> : rows.length === 0 && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><ClipboardList size={18} /></div><div className="empty-title">Пока нет инвентаризаций</div><p className="empty-description">Создайте первый пересчёт выше.</p></div></div> : <div className="table-wrap"><table><TableHead columns={stocktakeColumns} filters={filters} onFilter={(key, value) => setFilters((current) => ({ ...current, [key]: value }))} sort={sort} onSort={updateSort} /><tbody>{loadError ? <TableEmptyRow colSpan={stocktakeColumns.length} message={loadError} /> : loading && hasActiveFilters ? <TableEmptyRow colSpan={stocktakeColumns.length} message="Обновляем список…" /> : visibleRows.length === 0 ? <TableEmptyRow colSpan={stocktakeColumns.length} message="По заданным условиям совпадений нет." onClear={() => setFilters({})} /> : visibleRows.map((row) => {
        const lineId = getId(row.line) ?? String(row.id);
        const needsReview = String(row.resolutionStatus).startsWith("НУЖНА СВЕРКА");
        const resolved = Boolean(row.line.resolvedAt);
        const difference = Number(row.difference);
        return <tr key={String(row.id)}><td>{String(row.countedAt ?? "—").slice(0, 10)}</td><td>{String(row.warehouseLabel)}</td><td><span className="table-primary">{String(row.title ?? "—")}</span><span className="table-secondary">{String(row.sku ?? "")}</span>{needsReview && <span className="table-secondary" style={{ color: "#a64444" }}>{String(row.resolutionNote)}</span>}</td><td className="number">{String(row.expectedQuantity ?? "—")}</td><td className="number">{String(row.actualQuantity ?? "—")}</td><td><span className={`badge ${difference === 0 ? "green" : "orange"}`}>{difference > 0 ? "+" : ""}{Number.isFinite(difference) ? difference : "—"}</span></td><td><div className="row-actions">{needsReview ? <span className="badge red">Пересоздайте инвентаризацию</span> : resolved ? <span className="badge green">Разобрано</span> : <button className="button secondary small" disabled={busyLine === lineId} onClick={() => void resolve(row.line)}>Принять факт</button>}{row.lineIndex === 0 && <button className="icon-button" aria-label="Удалить всю инвентаризацию" title="Удалить инвентаризацию" disabled={busy} onClick={() => void removeStocktake(row.header)}><Trash2 size={14} /></button>}</div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </>;
}
