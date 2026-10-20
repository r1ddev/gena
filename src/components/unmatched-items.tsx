"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Link2, Plus, XCircle } from "lucide-react";
import { asRecord, findRows, getId, requestJson, type JsonRecord } from "./api";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";
import { filterAndSortRows, TableHead, type TableColumn, type TableSort } from "./table-controls";
import { ProductImageInput } from "./product-image-input";

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
function offerIdsFor(row: JsonRecord) {
  const related = Array.isArray(row.relatedOfferIds) ? row.relatedOfferIds.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
  return [...new Set([offerIdFor(row), ...related].filter(Boolean))];
}
function articleFor(row: JsonRecord) { const offerId = offerIdFor(row); if (offerId) return offerId; const offerIds = offerIdsFor(row); return offerIds.length === 1 ? offerIds[0] : ""; }
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

const unmatchedColumns: TableColumn<JsonRecord>[] = [
  { key: "article", label: "Артикул продавца / SKU Ozon", value: (row) => [...offerIdsFor(row), ozonSkuFor(row)].filter(Boolean).join(" ") },
  { key: "source", label: "Источник и сумма", value: (row) => `${sourceLabels[String(sourceInfoFor(row).kind ?? "other")] ?? sourceLabels.other} ${sourceDetails(row)}` },
  { key: "firstSeenAt", label: "Впервые замечен", kind: "date" },
  { key: "action", label: "Действие", sortable: false, filterable: false },
];

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
  const [productDrafts, setProductDrafts] = useState<Record<string, Record<string, string>>>({});
  const [productImages, setProductImages] = useState<Record<string, File | null>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<TableSort>(null);
  const visibleRows = useMemo(() => filterAndSortRows(rows, unmatchedColumns, filters, sort), [rows, filters, sort]);

  function updateSort(key: string) {
    setSort((current) => ({ key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

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
      const id = getId(row); if (!id) return null;
      const identifiers = [
        typeof row.offerId === "string" && row.offerId ? `Артикул ${row.offerId}` : "",
        typeof row.ozonSku === "string" && row.ozonSku ? `SKU Ozon ${row.ozonSku}` : "",
      ].filter(Boolean);
      return { id, label: `${String(row.title ?? "Товар")}${identifiers.length ? ` · ${identifiers.join(" · ")}` : ""}` };
    }).filter((item): item is Option => item !== null))).catch(() => setProducts([]));
  }, [refresh]);
  useEffect(() => {
    const refreshAfterSync = () => { void refresh(); };
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    return () => {
      window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    };
  }, [refresh]);

  async function decide(row: JsonRecord, action: "map" | "ignore") {
    const id = getId(row); if (!id) return;
    setBusy(id); setError(""); setSuccess("");
    const body = action === "map" ? { action, productId: selected[id] } : { action };
    try {
      await requestJson(`/api/external-items?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      setSuccess(action === "map" ? "Артикул связан с товаром каталога." : "Выбор игнорировать сохранён для последующих синхронизаций.");
      setMode((current) => { const { [id]: _removed, ...rest } = current; return rest; }); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить выбор"); }
    finally { setBusy(""); }
  }

  async function createProduct(event: React.FormEvent<HTMLFormElement>, row: JsonRecord, id: string, defaults: { title: string; offerId: string; ozonSku: string }) {
    event.preventDefault();
    setBusy(id); setError(""); setSuccess("");
    const draft = productDrafts[id] ?? {};
    const body = {
      action: "create",
      title: draft.title ?? defaults.title,
      offerId: draft.offerId ?? defaults.offerId,
      ozonSku: draft.ozonSku ?? defaults.ozonSku,
    };
    try {
      const formData = new FormData();
      Object.entries(body).forEach(([key, value]) => formData.append(key, value));
      const image = productImages[id];
      if (image) formData.append("image", image, image.name || "product-image");
      await requestJson(`/api/external-items?id=${encodeURIComponent(id)}`, { method: "PATCH", body: formData });
      setSuccess("Товар создан в каталоге и связан с записью Ozon.");
      setMode((current) => { const { [id]: _removed, ...rest } = current; return rest; });
      setProductDrafts((current) => { const { [id]: _removed, ...rest } = current; return rest; });
      setProductImages((current) => { const { [id]: _removed, ...rest } = current; return rest; });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать товар"); }
    finally { setBusy(""); }
  }

  const sourceBreakdown = Object.keys(sourceLabels).flatMap((key) => {
    const count = Number(sourceCounts[key] ?? 0);
    return count > 0 ? [sourceCountLabel(key, count)] : [];
  });

  return <section id="unmatched-ozon-items" className="panel" style={{ marginTop: 16 }}>
    <div className="panel-head"><div><h2>Записи Ozon без связи с каталогом</h2><span className="small-note">Это не число разных товаров. В списке есть заказы, начисления, возвраты, списания и выкупы.</span>{sourceBreakdown.length > 0 && <span className="small-note" style={{ display: "block", marginTop: 4 }}>{sourceBreakdown.join(" · ")}</span>}</div><span className="badge orange">{visibleRows.length === rows.length ? rows.length : `${visibleRows.length} / ${rows.length}`}</span></div>
    {error && <div className="error-banner" role="alert" style={{ margin: "12px 18px 0" }}><AlertCircle size={14} />{error}</div>}{success && <div className="success-banner" role="status" style={{ margin: "12px 18px 0" }}><CheckCircle2 size={14} />{success}</div>}
    {loading ? <div className="panel-body"><div className="loading-line" /></div> : rows.length === 0 && !error ? <div className="empty-state" style={{ minHeight: 130 }}><div><div className="empty-icon"><CheckCircle2 size={18} /></div><div className="empty-title">Нет записей без связи с каталогом</div><p className="empty-description">Такие записи появятся после синхронизации Ozon.</p></div></div> : visibleRows.length === 0 && !error ? <div className="empty-state"><div><div className="empty-title">Нет записей по этим фильтрам</div><button type="button" className="button secondary small" style={{ marginTop: 12 }} onClick={() => setFilters({})}>Очистить фильтры</button></div></div> : <div className="table-wrap"><table><TableHead columns={unmatchedColumns} filters={filters} onFilter={(key, value) => setFilters((current) => ({ ...current, [key]: value }))} sort={sort} onSort={updateSort} /><tbody>{visibleRows.map((row, index) => {
      const id = getId(row) ?? String(index); const currentMode = mode[id]; const ozonSku = ozonSkuFor(row); const article = articleFor(row); const productName = nameFor(row);
      const offerIds = offerIdsFor(row);
      const defaults = { title: productName, offerId: article, ozonSku };
      const draft = productDrafts[id] ?? {};
      const values = { title: draft.title ?? defaults.title, offerId: draft.offerId ?? defaults.offerId, ozonSku: draft.ozonSku ?? defaults.ozonSku };
      const setDraftValue = (field: string, value: string) => setProductDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
      const source = sourceInfoFor(row); const sourceKind = String(source.kind ?? "other");
      return <Fragment key={id}>
        <tr><td><span className="table-primary">Артикул продавца: {offerIds.length ? offerIds.join(", ") : "—"}</span><span className="table-secondary">SKU Ozon: {ozonSku || "—"}</span></td><td><span className="table-primary">{sourceLabels[sourceKind] ?? sourceLabels.other}</span><span className="table-secondary">{sourceDetails(row)}</span></td><td>{String(row.firstSeenAt ?? "—").slice(0, 10)}</td><td>
          {currentMode === "map" ? <div className="toolbar"><select aria-label="Выберите товар каталога" value={selected[id] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [id]: event.target.value }))}><option value="">Выберите товар…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}</select><button className="button small" disabled={!selected[id] || busy === id} onClick={() => void decide(row, "map")}><Link2 size={12} />Связать</button><button className="icon-button" aria-label="Отмена" onClick={() => setMode((current) => ({ ...current, [id]: undefined as never }))}><XCircle size={14} /></button></div>
            : currentMode === "create" ? <span className="small-note">Форма создания ниже</span>
              : <div className="row-actions"><button className="button secondary small" disabled={products.length === 0} onClick={() => setMode((current) => ({ ...current, [id]: "map" }))}><Link2 size={12} />Сопоставить</button><button className="button secondary small" onClick={() => setMode((current) => ({ ...current, [id]: "create" }))}><Plus size={12} />Создать товар</button><button className="button secondary small" disabled={busy === id} onClick={() => void decide(row, "ignore")}><XCircle size={12} />Игнорировать</button></div>}
        </td></tr>
        {currentMode === "create" && <tr><td colSpan={4}>
          <section className="panel form-panel" aria-label="Новый товар">
            <div className="panel-head"><h2>Новый товар</h2><span className="small-note">Поля со звёздочкой обязательны</span></div>
            <form className="panel-body" onSubmit={(event) => void createProduct(event, row, id, defaults)}>
              <div className="form-grid">
                <div className="field"><label htmlFor={`new-offer-id-${id}`}>Артикул</label><input id={`new-offer-id-${id}`} value={values.offerId} onChange={(event) => setDraftValue("offerId", event.target.value)} /></div>
                <div className="field wide"><label htmlFor={`new-title-${id}`}>Название товара *</label><input id={`new-title-${id}`} value={values.title} required onChange={(event) => setDraftValue("title", event.target.value)} /></div>
                <div className="field"><label htmlFor={`new-ozon-sku-${id}`}>SKU Ozon</label><input id={`new-ozon-sku-${id}`} value={values.ozonSku} onChange={(event) => setDraftValue("ozonSku", event.target.value)} /></div>
              </div>
              <ProductImageInput id={`new-product-image-${id}`} value={productImages[id] ?? null} onChange={(file) => setProductImages((current) => ({ ...current, [id]: file }))} />
              <div className="form-actions"><button type="button" className="button secondary" onClick={() => setMode((current) => ({ ...current, [id]: undefined }))}>Отмена</button><button className="button" disabled={busy === id}>{busy === id ? "Сохраняем…" : "Сохранить"}</button></div>
            </form>
          </section>
        </td></tr>}
      </Fragment>;
    })}</tbody></table></div>}
  </section>;
}
