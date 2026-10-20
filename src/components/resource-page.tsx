"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Package, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { asRecord, displayValue, findRows, getId, localToday, requestJson, valueAt, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "password";
  required?: boolean;
  step?: string;
  placeholder?: string;
  wide?: boolean;
  min?: string;
  options?: { value: string; label: string }[];
  optionsFrom?: string;
};

export type ColumnConfig = { key: string; label: string; kind?: "money" | "quantity" | "date" | "status"; primary?: boolean };
export type ResourceConfig = {
  title: string;
  eyebrow?: string;
  description: string;
  collectionUrl: string;
  createUrl: string;
  createLabel?: string;
  hideCreate?: boolean;
  fields: FieldConfig[];
  columns: ColumnConfig[];
  emptyTitle?: string;
  emptyDescription?: string;
  deleteUrl?: (row: JsonRecord) => string | null;
  help?: string;
};

export function buildResourcePayload(fields: FieldConfig[], formValues: Record<string, string>, defaultDate: string): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  for (const field of fields) {
    const value = formValues[field.name] ?? (field.type === "date" ? defaultDate : "");
    if (value === "") continue;
    payload[field.name] = field.type === "number" ? Number(value) : value;
  }
  return payload;
}

function labelFor(key: string) {
  const labels: Record<string, string> = {
    sku: "Артикул", title: "Товар", category: "Категория", offerId: "Артикул Ozon", ozonSku: "SKU Ozon",
    purchasedAt: "Дата закупки", orderedQuantity: "Заказано", amountPaid: "Оплачено", productId: "Товар",
    receivedAt: "Дата приёмки", receivedQuantity: "Принято", unitCost: "Цена за единицу", note: "Комментарий",
    suppliedAt: "Дата поставки", shippingCost: "Доставка", quantity: "Количество", spentAt: "Дата расхода",
    amount: "Сумма", orderNumber: "Номер отправления", status: "Статус", deliveredAt: "Доставлен",
    externalId: "Номер операции", destination: "Куда возвращается", returnedAt: "Дата возврата", receivedBySellerAt: "Получен продавцом",
    availableAtOzon: "Снова доступен на Ozon", warehouse: "Склад", countedAt: "Дата пересчёта", actualQuantity: "Фактически",
  };
  return labels[key] ?? key;
}

function Field({ config, value, onChange, productOptions }: { config: FieldConfig; value: string; onChange: (value: string) => void; productOptions: { value: string; label: string }[] }) {
  const type = config.type ?? "text";
  const fieldClass = config.wide ? "field wide" : "field";
  if (type === "textarea") return <div className={fieldClass}><label htmlFor={config.name}>{config.label}</label><textarea id={config.name} value={value} placeholder={config.placeholder} required={config.required} onChange={(event) => onChange(event.target.value)} /></div>;
  if (type === "select") {
    const options = config.optionsFrom ? productOptions : config.options ?? [];
    return <div className={fieldClass}><label htmlFor={config.name}>{config.label}</label><select id={config.name} value={value} required={config.required} onChange={(event) => onChange(event.target.value)}><option value="">Выберите…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
  }
  return <div className={fieldClass}><label htmlFor={config.name}>{config.label}</label><input id={config.name} type={type} value={value} required={config.required} min={config.min ?? (type === "number" ? "0" : undefined)} step={config.step} placeholder={config.placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

function productOptionsFrom(value: unknown) {
  return findRows(value).map((row) => {
    const id = getId(row);
    const title = typeof row.title === "string" ? row.title : "Товар";
    const sku = typeof row.sku === "string" ? row.sku : "";
    return id ? { value: id, label: sku ? `${title} · ${sku}` : title } : null;
  }).filter((option): option is { value: string; label: string } => option !== null);
}

export function ResourcePage({ config, actions, beforeTable, refreshKey, rowActions, onMutation }: { config: ResourceConfig; actions?: React.ReactNode; beforeTable?: React.ReactNode; refreshKey?: string | number; rowActions?: (row: JsonRecord, refresh: () => Promise<void>) => React.ReactNode; onMutation?: () => void }) {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setRows(findRows(await requestJson(config.collectionUrl))); }
    catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить список"); }
    finally { setLoading(false); }
  }, [config.collectionUrl]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  useEffect(() => {
    if (config.fields.some((field) => field.optionsFrom === "/api/products")) {
      requestJson("/api/products").then((value) => setProductOptions(productOptionsFrom(value))).catch(() => setProductOptions([]));
    }
  }, [config.fields]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    if (!query) return rows;
    return rows.filter((row) => JSON.stringify(row).toLocaleLowerCase("ru-RU").includes(query));
  }, [rows, search]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    const payload = buildResourcePayload(config.fields, formValues, localToday());
    try {
      await requestJson(config.createUrl, { method: "POST", body: JSON.stringify(payload) });
      setFormValues({}); setFormOpen(false); setSuccess("Запись добавлена. Итоги пересчитаны."); onMutation?.(); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить запись"); }
    finally { setBusy(false); }
  }

  async function remove(row: JsonRecord) {
    if (!config.deleteUrl) return;
    const url = config.deleteUrl(row);
    if (!url) return;
    if (typeof window !== "undefined" && !window.confirm("Удалить эту запись? Связанные остатки и итоги будут пересчитаны.")) return;
    setBusy(true); setError(""); setSuccess("");
    try { await requestJson(url, { method: "DELETE" }); setSuccess("Запись удалена. Итоги пересчитаны."); onMutation?.(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить запись"); }
    finally { setBusy(false); }
  }

  const hasProductSelect = config.fields.some((field) => field.optionsFrom);
  return <>
    <PageHeader eyebrow={config.eyebrow ?? "Учёт операций"} title={config.title} description={config.description} actions={<div className="toolbar">{actions}{!config.hideCreate && <button className="button" onClick={() => { setFormOpen((open) => !open); setError(""); setSuccess(""); }}><Plus size={15} />{formOpen ? "Закрыть форму" : config.createLabel}</button>}</div>} />
    {error && <div className="error-banner" role="alert"><AlertCircle size={16} />{error}</div>}
    {success && <div className="success-banner" role="status"><CheckCircle2 size={16} />{success}</div>}
    {formOpen && <section className="panel form-panel" aria-label={`Новая запись: ${config.title}`}>
      <div className="panel-head"><h2>Новая запись</h2><span className="small-note">Поля со звёздочкой обязательны</span></div>
      <form className="panel-body" onSubmit={submit}>
        <div className="form-grid">{config.fields.map((field) => <Field key={field.name} config={field} value={formValues[field.name] ?? (field.type === "date" ? localToday() : "")} productOptions={productOptions} onChange={(value) => setFormValues((current) => ({ ...current, [field.name]: value }))} />)}</div>
        {config.help && <p className="form-help">{config.help}</p>}
        {hasProductSelect && productOptions.length === 0 && <p className="form-help">Сначала добавьте товар в каталог, чтобы выбрать его здесь.</p>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setFormOpen(false)}>Отмена</button><button className="button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button></div>
      </form>
    </section>}
    {beforeTable}
    <section className="panel">
      <div className="panel-head"><div><h2>Список записей</h2><span className="small-note">{loading ? "Обновляем…" : `${visibleRows.length} ${visibleRows.length === 1 ? "запись" : "записей"}`}</span></div><div className="toolbar"><div className="search-box"><Search size={14} /><input aria-label="Поиск по таблице" placeholder="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="icon-button" aria-label="Обновить список" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} /></button></div></div>
      {loading ? <div className="panel-body" aria-label="Загрузка списка"><div className="loading-line" /><div style={{ height: 10 }} /><div className="loading-line" /><div style={{ height: 10 }} /><div className="loading-line" /></div>
        : loadError ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={20} /></div><div className="empty-title">Не удалось загрузить данные</div><p className="empty-description">{loadError}</p><button className="button secondary" style={{ marginTop: 13 }} onClick={() => void refresh()}>Повторить</button></div></div>
          : visibleRows.length === 0 ? <div className="empty-state"><div><div className="empty-icon"><Package size={20} /></div><div className="empty-title">{config.emptyTitle ?? "Пока нет записей"}</div><p className="empty-description">{config.emptyDescription ?? "Добавьте первую запись — она появится в этом списке, а связанные итоги обновятся автоматически."}</p></div></div>
            : <div className="table-wrap"><table><thead><tr>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}{(config.deleteUrl || rowActions) && <th aria-label="Действия" />}</tr></thead><tbody>{visibleRows.map((row, index) => <tr key={getId(row) ?? index}>{config.columns.map((column) => {
              const value = valueAt(row, column.key);
              if (column.primary) return <td key={column.key}><span className="table-primary">{displayValue(value, column.kind)}</span>{typeof row.sku === "string" && column.key !== "sku" && <span className="table-secondary">{row.sku}</span>}</td>;
              const rendered = column.key === "archived" ? (value ? "В архиве" : "Активен") : displayValue(value, column.kind);
              return <td key={column.key} className={column.kind === "money" || column.kind === "quantity" ? "number" : ""}>{column.key.toLowerCase().includes("status") || column.key === "archived" ? <span className={`badge ${column.key === "archived" && !value ? "green" : ""}`}>{rendered}</span> : rendered}</td>;
            })}{(config.deleteUrl || rowActions) && <td><div className="row-actions">{config.deleteUrl?.(row) && <button className="icon-button" aria-label={`Удалить запись ${index + 1}`} onClick={() => void remove(row)} disabled={busy}><Trash2 size={14} /></button>}{rowActions?.(row, refresh)}</div></td>}</tr>)}</tbody></table></div>}
    </section>
  </>;
}

export function readObject(value: unknown) { return asRecord(value); }
