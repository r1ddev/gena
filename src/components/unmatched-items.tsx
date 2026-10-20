"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Link2, Plus, RefreshCw, XCircle } from "lucide-react";
import { findRows, getId, requestJson, type JsonRecord } from "./api";

type Option = { id: string; label: string };

export function UnmatchedItems() {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");
  const [mode, setMode] = useState<Record<string, "map" | "create" | undefined>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [sku, setSku] = useState<Record<string, string>>({});
  const [title, setTitle] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(findRows(await requestJson("/api/external-items"))); }
    catch (reason) { setRows([]); setError(reason instanceof Error ? reason.message : "Не удалось загрузить несопоставленные ID"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    requestJson("/api/products").then((value) => setProducts(findRows(value).map((row) => {
      const id = getId(row); if (!id) return null; const code = typeof row.sku === "string" ? row.sku : ""; return { id, label: code ? `${String(row.title ?? "Товар")} · ${code}` : String(row.title ?? "Товар") };
    }).filter((item): item is Option => item !== null))).catch(() => setProducts([]));
  }, [refresh]);

  async function decide(row: JsonRecord, action: "map" | "create" | "ignore") {
    const id = getId(row); if (!id) return;
    setBusy(id); setError(""); setSuccess("");
    const body = action === "map" ? { action, productId: selected[id] } : action === "create" ? { action, sku: sku[id] || String(row.offerId ?? row.externalKey ?? ""), title: title[id] || String(row.title ?? "Товар Ozon"), category: "Без категории" } : { action };
    try {
      await requestJson(`/api/external-items?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      setSuccess(action === "map" ? "Артикул связан с товаром каталога." : action === "create" ? "Товар создан и связан с артикулом Ozon." : "Выбор игнорировать сохранён для последующих синхронизаций.");
      setMode((current) => { const { [id]: _removed, ...rest } = current; return rest; }); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить выбор"); }
    finally { setBusy(""); }
  }

  return <section className="panel" style={{ marginTop: 16 }}>
    <div className="panel-head"><div><h2>Несопоставленные товары Ozon</h2><span className="small-note">Выбор сохраняется и применяется при следующих обновлениях</span></div><div className="toolbar"><span className="badge orange">{rows.length}</span><button className="icon-button" aria-label="Обновить список" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} /></button></div></div>
    {error && <div className="error-banner" role="alert" style={{ margin: "12px 18px 0" }}><AlertCircle size={14} />{error}</div>}{success && <div className="success-banner" role="status" style={{ margin: "12px 18px 0" }}><CheckCircle2 size={14} />{success}</div>}
    {loading ? <div className="panel-body"><div className="loading-line" /></div> : rows.length === 0 && !error ? <div className="empty-state" style={{ minHeight: 130 }}><div><div className="empty-icon"><CheckCircle2 size={18} /></div><div className="empty-title">Все товары сопоставлены</div><p className="empty-description">Новые неизвестные артикулы появятся здесь после синхронизации.</p></div></div> : <div className="table-wrap"><table><thead><tr><th>Артикул / SKU Ozon</th><th>Название из Ozon</th><th>Впервые замечен</th><th>Действие</th></tr></thead><tbody>{rows.map((row, index) => {
      const id = getId(row) ?? String(index); const currentMode = mode[id];
      return <tr key={id}><td><span className="table-primary">{String(row.offerId || row.externalKey || "—")}</span><span className="table-secondary">SKU Ozon: {String(row.ozonSku || "—")}</span></td><td>{String(row.title ?? "Без названия")}</td><td>{String(row.firstSeenAt ?? "—").slice(0, 10)}</td><td>
        {currentMode === "map" ? <div className="toolbar"><select aria-label="Выберите товар каталога" value={selected[id] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [id]: event.target.value }))}><option value="">Выберите товар…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}</select><button className="button small" disabled={!selected[id] || busy === id} onClick={() => void decide(row, "map")}><Link2 size={12} />Связать</button><button className="icon-button" aria-label="Отмена" onClick={() => setMode((current) => ({ ...current, [id]: undefined as never }))}><XCircle size={14} /></button></div>
          : currentMode === "create" ? <div className="toolbar"><input aria-label="Внутренний артикул" value={sku[id] ?? String(row.offerId || row.externalKey || "")} onChange={(event) => setSku((current) => ({ ...current, [id]: event.target.value }))} placeholder="Артикул" /><input aria-label="Название товара" value={title[id] ?? String(row.title ?? "")} onChange={(event) => setTitle((current) => ({ ...current, [id]: event.target.value }))} placeholder="Название" /><button className="button small" disabled={(!sku[id] && !row.offerId && !row.externalKey) || busy === id} onClick={() => void decide(row, "create")}><Plus size={12} />Создать</button><button className="icon-button" aria-label="Отмена" onClick={() => setMode((current) => ({ ...current, [id]: undefined }))}><XCircle size={14} /></button></div>
          : <div className="row-actions"><button className="button secondary small" disabled={products.length === 0} onClick={() => setMode((current) => ({ ...current, [id]: "map" }))}><Link2 size={12} />Сопоставить</button><button className="button secondary small" onClick={() => setMode((current) => ({ ...current, [id]: "create" }))}><Plus size={12} />Создать товар</button><button className="button secondary small" disabled={busy === id} onClick={() => void decide(row, "ignore")}><XCircle size={12} />Игнорировать</button></div>}
      </td></tr>;
    })}</tbody></table></div>}
  </section>;
}
