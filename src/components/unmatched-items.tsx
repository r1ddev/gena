"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Link2, Plus, XCircle } from "lucide-react";
import { asRecord, findRows, getId, requestJson, type JsonRecord } from "./api";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";

type Option = { id: string; label: string };
const sourceLabels: Record<string, string> = {
  finance: "Начисление по заказу",
  order: "Товар в заказе",
  return: "Возврат",
  writeoff: "Списание Ozon",
  buyout: "Выкуп Ozon",
  other: "Другая запись Ozon",
};
const sourceCountForms: Record<string, [string, string, string]> = {
  finance: ["денежная строка по заказу", "денежные строки по заказам", "денежных строк по заказам"],
  order: ["позиция заказа", "позиции заказов", "позиций заказов"],
  return: ["возврат", "возврата", "возвратов"],
  writeoff: ["списание Ozon", "списания Ozon", "списаний Ozon"],
  buyout: ["отчёт о выкупе", "отчёта о выкупе", "отчётов о выкупе"],
  other: ["другая запись", "другие записи", "других записей"],
};

function offerIdFor(row: JsonRecord) { return typeof row.offerId === "string" ? row.offerId : ""; }
function ozonSkuFor(row: JsonRecord) { return typeof row.ozonSku === "string" ? row.ozonSku : ""; }
function articleFor(row: JsonRecord) { return offerIdFor(row) || ozonSkuFor(row); }
function nameFor(row: JsonRecord) {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  return title && title !== `Ozon SKU ${ozonSkuFor(row)}` ? title : "";
}
function sourceInfoFor(row: JsonRecord) { return asRecord(row.sourceInfo) ?? {}; }
function sourceCountLabel(kind: string, count: number) {
  const forms = sourceCountForms[kind] ?? sourceCountForms.other;
  const mod100 = count % 100;
  const mod10 = count % 10;
  const form = mod100 >= 11 && mod100 <= 14 ? forms[2] : mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2];
  return `${count} ${form}`;
}
function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount < 0 ? "−" : amount > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.abs(amount))} ₽` : "";
}
function sourceDetails(row: JsonRecord) {
  const source = sourceInfoFor(row);
  const posting = typeof source.postingNumber === "string" && source.postingNumber ? `Заказ ${source.postingNumber}` : "";
  const amount = money(source.amount);
  const dateValue = typeof source.accrualDate === "string" ? source.accrualDate : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue.split("-").reverse().join(".") : dateValue;
  const quantity = source.quantity != null ? `${String(source.quantity)} шт.` : "";
  const destination = source.destination === "seller" ? "возврат тебе" : source.destination === "ozon" ? "возврат на склад Ozon" : "";
  const status = typeof source.status === "string" && source.status ? source.status : "";
  return [posting, amount, quantity, destination, status, date].filter(Boolean).join(" · ") || "Источник указан Ozon";
}

export function UnmatchedItems() {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [sourceCounts, setSourceCounts] = useState<Record<string, unknown>>({});
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
    try {
      const response = await requestJson("/api/external-items");
      setRows(findRows(response));
      setSourceCounts(asRecord(asRecord(response)?.sourceCounts) ?? {});
    }
    catch (reason) { setRows([]); setSourceCounts({}); setError(reason instanceof Error ? reason.message : "Не удалось загрузить несопоставленные записи Ozon"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    requestJson("/api/products").then((value) => setProducts(findRows(value).map((row) => {
      const id = getId(row); if (!id) return null; const code = typeof row.sku === "string" ? row.sku : ""; return { id, label: code ? `${String(row.title ?? "Товар")} · ${code}` : String(row.title ?? "Товар") };
    }).filter((item): item is Option => item !== null))).catch(() => setProducts([]));
  }, [refresh]);
  useEffect(() => {
    const refreshAfterSync = () => { void refresh(); };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    window.addEventListener("focus", refreshAfterSync);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
      window.removeEventListener("focus", refreshAfterSync);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  async function decide(row: JsonRecord, action: "map" | "create" | "ignore") {
    const id = getId(row); if (!id) return;
    setBusy(id); setError(""); setSuccess("");
    const body = action === "map" ? { action, productId: selected[id] } : action === "create" ? { action, sku: sku[id] || articleFor(row), title: title[id] || nameFor(row) || "Товар Ozon", category: "Без категории" } : { action };
    try {
      await requestJson(`/api/external-items?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      setSuccess(action === "map" ? "Артикул связан с товаром каталога." : action === "create" ? "Товар создан и связан с артикулом Ozon." : "Выбор игнорировать сохранён для последующих синхронизаций.");
      setMode((current) => { const { [id]: _removed, ...rest } = current; return rest; }); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить выбор"); }
    finally { setBusy(""); }
  }

  const sourceBreakdown = Object.keys(sourceLabels).flatMap((key) => {
    const count = Number(sourceCounts[key] ?? 0);
    return count > 0 ? [sourceCountLabel(key, count)] : [];
  });

  return <section id="unmatched-ozon-items" className="panel" style={{ marginTop: 16 }}>
    <div className="panel-head"><div><h2>Записи Ozon без связи с каталогом</h2><span className="small-note">Это не число разных товаров. В списке есть заказы, начисления, возвраты, списания и выкупы.</span>{sourceBreakdown.length > 0 && <span className="small-note" style={{ display: "block", marginTop: 4 }}>{sourceBreakdown.join(" · ")}</span>}</div><span className="badge orange">{rows.length}</span></div>
    {error && <div className="error-banner" role="alert" style={{ margin: "12px 18px 0" }}><AlertCircle size={14} />{error}</div>}{success && <div className="success-banner" role="status" style={{ margin: "12px 18px 0" }}><CheckCircle2 size={14} />{success}</div>}
    {loading ? <div className="panel-body"><div className="loading-line" /></div> : rows.length === 0 && !error ? <div className="empty-state" style={{ minHeight: 130 }}><div><div className="empty-icon"><CheckCircle2 size={18} /></div><div className="empty-title">Нет записей без связи с каталогом</div><p className="empty-description">Такие записи появятся после синхронизации Ozon.</p></div></div> : <div className="table-wrap"><table><thead><tr><th>Артикул / SKU Ozon</th><th>Источник и сумма</th><th>Название товара</th><th>Впервые замечен</th><th>Действие</th></tr></thead><tbody>{rows.map((row, index) => {
      const id = getId(row) ?? String(index); const currentMode = mode[id]; const offerId = offerIdFor(row); const ozonSku = ozonSkuFor(row); const article = articleFor(row); const productName = nameFor(row);
      const source = sourceInfoFor(row); const sourceKind = String(source.kind ?? "other");
      return <tr key={id}><td><span className="table-primary">{offerId || (ozonSku ? `SKU Ozon ${ozonSku}` : "Артикул не передан Ozon")}</span>{offerId && ozonSku && <span className="table-secondary">SKU Ozon: {ozonSku}</span>}</td><td><span className="table-primary">{sourceLabels[sourceKind] ?? sourceLabels.other}</span><span className="table-secondary">{sourceDetails(row)}</span></td><td>{productName || "Название не передано Ozon"}</td><td>{String(row.firstSeenAt ?? "—").slice(0, 10)}</td><td>
        {currentMode === "map" ? <div className="toolbar"><select aria-label="Выберите товар каталога" value={selected[id] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [id]: event.target.value }))}><option value="">Выберите товар…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}</select><button className="button small" disabled={!selected[id] || busy === id} onClick={() => void decide(row, "map")}><Link2 size={12} />Связать</button><button className="icon-button" aria-label="Отмена" onClick={() => setMode((current) => ({ ...current, [id]: undefined as never }))}><XCircle size={14} /></button></div>
          : currentMode === "create" ? <div className="toolbar"><input aria-label="Внутренний артикул" value={sku[id] ?? article} onChange={(event) => setSku((current) => ({ ...current, [id]: event.target.value }))} placeholder="Артикул" /><input aria-label="Название товара" value={title[id] ?? productName} onChange={(event) => setTitle((current) => ({ ...current, [id]: event.target.value }))} placeholder="Название" /><button className="button small" disabled={(!sku[id] && !article) || !(title[id] ?? productName).trim() || busy === id} onClick={() => void decide(row, "create")}><Plus size={12} />Создать</button><button className="icon-button" aria-label="Отмена" onClick={() => setMode((current) => ({ ...current, [id]: undefined }))}><XCircle size={14} /></button></div>
          : <div className="row-actions"><button className="button secondary small" disabled={products.length === 0} onClick={() => setMode((current) => ({ ...current, [id]: "map" }))}><Link2 size={12} />Сопоставить</button><button className="button secondary small" onClick={() => setMode((current) => ({ ...current, [id]: "create" }))}><Plus size={12} />Создать товар</button><button className="button secondary small" disabled={busy === id} onClick={() => void decide(row, "ignore")}><XCircle size={12} />Игнорировать</button></div>}
      </td></tr>;
    })}</tbody></table></div>}
  </section>;
}
