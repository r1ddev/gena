"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { asRecord, displayValue, findRows, getId, localToday, requestJson, stringValue, valueAt, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";
import { cycleTableSort, filterAndSortRows, TableEmptyRow, TableHead, type TableSort } from "./table-controls";
import { ProductImageInput } from "./product-image-input";
import { notifyProductCatalogChanged, ProductArticle } from "./product-hover-card";

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

export type ColumnConfig = { key: string; label: string; kind?: "identifier" | "money" | "quantity" | "date" | "status" | "number" | "time"; primary?: boolean; sortable?: boolean; filterable?: boolean };
export type ResourceConfig = {
  title: string;
  eyebrow?: string;
  description: string;
  collectionUrl: string;
  createUrl: string;
  createLabel?: string;
  hideCreate?: boolean;
  imageUpload?: boolean;
  fields: FieldConfig[];
  columns: ColumnConfig[];
  remotePageSize?: number;
  showSoldQuantity?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  deleteUrl?: (row: JsonRecord) => string | null;
  deleteConfirm?: string;
  deleteSuccess?: string;
  editUrl?: (row: JsonRecord) => string | null;
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

function orderArticleItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  const quantities = new Map<string, { article: string; quantity: number; productId: string | null; identifierLabel: "Артикул" | "SKU Ozon"; details: JsonRecord }>();
  value.forEach((item) => {
    const row = asRecord(item);
    if (!row) return;
    const article = stringValue(row.sku) ?? stringValue(row.offerId) ?? stringValue(row.ozonSku);
    const quantity = Number(row.quantity ?? 1);
    const key = article ?? "Артикул не указан";
    if (!Number.isFinite(quantity)) return;
    const current = quantities.get(key);
    quantities.set(key, {
      article: key,
      quantity: (current?.quantity ?? 0) + quantity,
      productId: current?.productId ?? stringValue(row.productId),
      identifierLabel: current?.identifierLabel ?? (stringValue(row.sku) || stringValue(row.offerId) ? "Артикул" : "SKU Ozon"),
      details: current?.details ?? row,
    });
  });
  return [...quantities.values()];
}

function orderArticleText(value: unknown) {
  if (!Array.isArray(value)) return displayValue(value);
  return orderArticleItems(value).map(({ article, quantity }) => `${article} × ${displayValue(quantity, "quantity")}`).join("; ") || "—";
}

function supplyArticleList(row: JsonRecord) {
  if (!Array.isArray(row.lines)) return null;
  const lines = row.lines.flatMap((value, index) => {
    const line = asRecord(value);
    if (!line) return [];
    return [{
      key: getId(line) ?? `${stringValue(line.sku) ?? "article"}-${index}`,
      sku: stringValue(line.sku) || "Артикул не указан",
      productId: stringValue(line.productId),
      details: line,
      quantity: displayValue(line.quantity ?? 0, "quantity"),
    }];
  });
  if (lines.length === 0) return null;
  return <div className="supply-article-list" role="list" aria-label={`Артикулы в поставке: ${lines.length}`}>
    {lines.map((line) => <span className="supply-article-chip" role="listitem" key={line.key}>
      <ProductArticle identifier={line.sku} productId={line.productId} fallback={line.details} className="supply-article-code" />
      <strong>× {line.quantity}</strong>
    </span>)}
  </div>;
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
    const identifiers = [
      typeof row.offerId === "string" && row.offerId ? `Артикул ${row.offerId}` : "",
      typeof row.ozonSku === "string" && row.ozonSku ? `SKU Ozon ${row.ozonSku}` : "",
    ].filter(Boolean);
    return id ? { value: id, label: `${title}${identifiers.length ? ` · ${identifiers.join(" · ")}` : ""}` } : null;
  }).filter((option): option is { value: string; label: string } => option !== null);
}

type PageItem = number | "ellipsis";

function pageItems(currentPage: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function ResourcePage({ config, actions, beforeTable, refreshKey, rowActions, onMutation }: { config: ResourceConfig; actions?: React.ReactNode; beforeTable?: React.ReactNode; refreshKey?: string | number; rowActions?: (row: JsonRecord, refresh: () => Promise<void>) => React.ReactNode; onMutation?: () => void }) {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [pagination, setPagination] = useState<{ page: number; pageSize: number; total: number; totalPages: number } | null>(null);
  const [soldQuantity, setSoldQuantity] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [editingRow, setEditingRow] = useState<JsonRecord | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [productImage, setProductImage] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [serverFilters, setServerFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<TableSort>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      let url = config.collectionUrl;
      if (config.remotePageSize) {
        const params = new URLSearchParams({ page: String(page), pageSize: String(config.remotePageSize) });
        if (serverSearch) params.set("q", serverSearch);
        for (const [key, value] of Object.entries(serverFilters)) if (value.trim()) params.set(`filter_${key}`, value.trim());
        if (sort) { params.set("sort", sort.key); params.set("direction", sort.direction); }
        url += `${url.includes("?") ? "&" : "?"}${params.toString()}`;
      }
      const result = await requestJson(url);
      if (sequence !== requestSequence.current) return;
      setRows(findRows(result));
      const summary = asRecord(asRecord(result)?.summary);
      setSoldQuantity(typeof summary?.soldQuantity === "number" && Number.isFinite(summary.soldQuantity) ? summary.soldQuantity : null);
      const remotePage = asRecord(asRecord(result)?.pagination);
      if (remotePage && typeof remotePage.page === "number" && typeof remotePage.pageSize === "number" && typeof remotePage.total === "number" && typeof remotePage.totalPages === "number") {
        setPagination({ page: remotePage.page, pageSize: remotePage.pageSize, total: remotePage.total, totalPages: remotePage.totalPages });
        if (remotePage.page !== page) setPage(remotePage.page);
      } else setPagination(null);
    }
    catch (reason) {
      if (sequence === requestSequence.current) {
        setRows([]); setPagination(null); setSoldQuantity(null); setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить список");
      }
    }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [config.collectionUrl, config.remotePageSize, page, serverFilters, serverSearch, sort]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  useEffect(() => {
    if (!config.remotePageSize) return;
    if (search.trim() !== serverSearch || JSON.stringify(filters) !== JSON.stringify(serverFilters)) {
      requestSequence.current++;
      setLoading(false);
    }
    const timeout = window.setTimeout(() => {
      setServerSearch(search.trim());
      setServerFilters(filters);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [config.remotePageSize, filters, search, serverFilters, serverSearch]);
  useEffect(() => {
    const refreshAfterSync = () => { void refresh(); };
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    return () => window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
  }, [refresh]);
  useEffect(() => {
    if (config.fields.some((field) => field.optionsFrom === "/api/products")) {
      requestJson("/api/products").then((value) => setProductOptions(productOptionsFrom(value))).catch(() => setProductOptions([]));
    }
  }, [config.fields]);

  const visibleRows = useMemo(() => {
    if (config.remotePageSize) return rows;
    const query = search.trim().toLocaleLowerCase("ru-RU");
    const filteredAndSorted = filterAndSortRows(rows, config.columns, filters, sort);
    if (!query) return filteredAndSorted;
    return filteredAndSorted.filter((row) => JSON.stringify(row).toLocaleLowerCase("ru-RU").includes(query));
  }, [config.columns, config.remotePageSize, filters, rows, search, sort]);

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (config.remotePageSize) setPage(1);
  }

  function updateSort(key: string) {
    setSort((current) => cycleTableSort(current, key));
    if (config.remotePageSize) setPage(1);
  }

  function clearTableFilters() {
    setFilters({});
    setSearch("");
    if (config.remotePageSize) setPage(1);
  }

  function openEdit(row: JsonRecord) {
    if (!config.editUrl?.(row)) return;
    setFormOpen(false);
    setEditingRow(row);
    setEditingValues(Object.fromEntries(config.fields.map((field) => [field.name, typeof row[field.name] === "string" ? row[field.name] as string : ""])));
    setProductImage(null);
    setRemoveExistingImage(false);
    setError(""); setSuccess("");
  }

  function closeEdit() {
    setEditingRow(null);
    setEditingValues({});
    setProductImage(null);
    setRemoveExistingImage(false);
    setError("");
  }

  async function submitRecord(event: React.FormEvent<HTMLFormElement>, editing: boolean) {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    const payload = buildResourcePayload(config.fields, editing ? editingValues : formValues, localToday());
    try {
      const body = config.imageUpload ? new FormData() : JSON.stringify(payload);
      if (body instanceof FormData) {
        Object.entries(payload).forEach(([key, value]) => body.append(key, String(value)));
        if (productImage) body.append("image", productImage, productImage.name || "product-image");
        if (editing && removeExistingImage && !productImage) body.append("removeImage", "true");
      }
      const url = editing && editingRow ? config.editUrl?.(editingRow) : config.createUrl;
      if (!url) throw new Error("Не удалось определить запись для редактирования.");
      await requestJson(url, { method: editing ? "PATCH" : "POST", body });
      if (config.collectionUrl === "/api/products") notifyProductCatalogChanged();
      setFormValues({}); setProductImage(null); setFormOpen(false);
      if (editing) closeEdit();
      setSuccess(editing ? "Товар сохранён." : "Запись добавлена. Связанные итоги обновлены автоматически."); onMutation?.(); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить запись"); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) { await submitRecord(event, false); }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) { await submitRecord(event, true); }

  async function remove(row: JsonRecord) {
    if (!config.deleteUrl) return;
    const url = config.deleteUrl(row);
    if (!url) return;
    if (typeof window !== "undefined" && !window.confirm(config.deleteConfirm ?? "Удалить эту запись? Связанные остатки и итоги обновятся автоматически.")) return;
    setBusy(true); setError(""); setSuccess("");
    try { await requestJson(url, { method: "DELETE" }); if (config.collectionUrl === "/api/products") notifyProductCatalogChanged(); setSuccess(config.deleteSuccess ?? "Запись удалена. Связанные итоги обновлены автоматически."); onMutation?.(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить запись"); }
    finally { setBusy(false); }
  }

  const hasProductSelect = config.fields.some((field) => field.optionsFrom);
  const hasActiveFilters = Boolean(search.trim() || serverSearch.trim() || Object.values(filters).some((value) => value.trim()) || Object.values(serverFilters).some((value) => value.trim()));
  const tableColumnCount = config.columns.length + (config.deleteUrl || config.editUrl || rowActions ? 1 : 0);
  return <>
    <PageHeader eyebrow={config.eyebrow ?? "Учёт операций"} title={config.title} description={config.description} actions={<div className="toolbar">{actions}{!config.hideCreate && <button className="button" onClick={() => { setFormOpen((open) => !open); setError(""); setSuccess(""); }}><Plus size={15} />{formOpen ? "Закрыть форму" : config.createLabel}</button>}</div>} />
    {config.showSoldQuantity && <section className="panel metric-card" style={{ "--metric-bg": "#eef5fa", marginBottom: 16 } as React.CSSProperties} aria-label="Проданные товары"><Package className="metric-icon" size={18} /><div className="metric-label">Продано товаров</div><div className="metric-value">{soldQuantity === null ? loading ? "…" : "—" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(soldQuantity)} шт.`}</div><div className="metric-help">Доставленные и выкупленные Ozon товары за всё время, за вычетом возвратов</div></section>}
    {error && !editingRow && <div className="error-banner" role="alert"><AlertCircle size={16} />{error}</div>}
    {success && <div className="success-banner" role="status"><CheckCircle2 size={16} />{success}</div>}
    {formOpen && <section className="panel form-panel" aria-label={`Новая запись: ${config.title}`}>
      <div className="panel-head"><h2>Новая запись</h2><span className="small-note">Поля со звёздочкой обязательны</span></div>
      <form className="panel-body" onSubmit={submit}>
        <div className="form-grid">{config.fields.map((field) => <Field key={field.name} config={field} value={formValues[field.name] ?? (field.type === "date" ? localToday() : "")} productOptions={productOptions} onChange={(value) => setFormValues((current) => ({ ...current, [field.name]: value }))} />)}</div>
        {config.imageUpload && <ProductImageInput id="new-product-image" value={productImage} onChange={setProductImage} />}
        {config.help && <p className="form-help">{config.help}</p>}
        {hasProductSelect && productOptions.length === 0 && <p className="form-help">Сначала добавьте товар в каталог, чтобы выбрать его здесь.</p>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setFormOpen(false)}>Отмена</button><button className="button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button></div>
      </form>
    </section>}
    {editingRow && <div className="product-edit-backdrop">
      <section className="panel product-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="product-edit-title">
        <div className="panel-head"><div><h2 id="product-edit-title">Редактирование товара</h2><span className="small-note">Поля со звёздочкой обязательны</span></div><button type="button" className="icon-button" aria-label="Закрыть редактирование" onClick={closeEdit}><X size={15} /></button></div>
        <form className="panel-body" onSubmit={submitEdit}>
          {error && <div className="error-banner" role="alert"><AlertCircle size={16} />{error}</div>}
          <div className="form-grid">{config.fields.map((field) => <Field key={field.name} config={field} value={editingValues[field.name] ?? ""} productOptions={productOptions} onChange={(value) => setEditingValues((current) => ({ ...current, [field.name]: value }))} />)}</div>
          {config.imageUpload && <ProductImageInput
            id="edit-product-image"
            value={productImage}
            existingImageUrl={!removeExistingImage && typeof editingRow.imageUrl === "string" ? editingRow.imageUrl : undefined}
            onChange={(file) => { setProductImage(file); if (file) setRemoveExistingImage(false); }}
            onRemoveExisting={() => setRemoveExistingImage(true)}
          />}
          {config.help && <p className="form-help">{config.help}</p>}
          <div className="form-actions"><button type="button" className="button secondary" onClick={closeEdit}>Отмена</button><button className="button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button></div>
        </form>
      </section>
    </div>}
    {beforeTable}
    <section className="panel">
      <div className="panel-head"><div><h2>Список записей</h2><span className="small-note">{loading ? "Загружаем список…" : config.remotePageSize ? `${pagination?.total ?? 0} записей` : `${visibleRows.length} ${visibleRows.length === 1 ? "запись" : "записей"}`}</span></div><div className="toolbar"><div className="search-box"><Search size={14} /><input aria-label="Поиск по таблице" placeholder={config.remotePageSize ? "Поиск по заказам" : "Поиск"} value={search} onChange={(event) => setSearch(event.target.value)} /></div></div></div>
      {loading && rows.length === 0 && !hasActiveFilters ? <div className="panel-body" aria-label="Загрузка списка"><div className="loading-line" /><div style={{ height: 10 }} /><div className="loading-line" /><div style={{ height: 10 }} /><div className="loading-line" /></div>
        : loadError && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={20} /></div><div className="empty-title">Не удалось загрузить данные</div><p className="empty-description">{loadError}</p><button className="button secondary" style={{ marginTop: 13 }} onClick={() => void refresh()}>Повторить</button></div></div>
          : rows.length === 0 && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><Package size={20} /></div><div className="empty-title">{config.emptyTitle ?? "Пока нет записей"}</div><p className="empty-description">{config.emptyDescription ?? "Добавьте первую запись — она появится в этом списке, а связанные итоги обновятся автоматически."}</p></div></div>
            : <div className="table-wrap"><table><TableHead columns={config.columns.map((column) => ({
              ...column,
              kind: column.kind ?? (column.key === "id" || column.key === "externalId" ? "identifier" : "text"),
              value: column.key === "article" ? (row: JsonRecord) => orderArticleText(row.items)
                : column.key === "status" ? (row: JsonRecord) => [row.status, row.returnState].filter(Boolean).join(" ")
                  : (row: JsonRecord) => valueAt(row, column.key),
            }))} filters={filters} onFilter={updateFilter} sort={sort} onSort={updateSort} trailingHeaders={config.deleteUrl || config.editUrl || rowActions ? ["Действия"] : []} /><tbody>{loadError ? <TableEmptyRow colSpan={tableColumnCount} message={loadError} /> : config.remotePageSize && loading ? <TableEmptyRow colSpan={tableColumnCount} message="Обновляем список…" /> : visibleRows.length === 0 ? <TableEmptyRow colSpan={tableColumnCount} message="По заданным условиям совпадений нет." onClear={clearTableFilters} /> : visibleRows.map((row, index) => <tr key={getId(row) ?? index}>{config.columns.map((column) => {
              const value = valueAt(row, column.key);
              const displayKind = column.kind === "date" || column.kind === "money" || column.kind === "quantity" || column.kind === "status" ? column.kind : undefined;
              if (["sku", "offerId", "ozonSku"].includes(column.key)) {
                const identifier = stringValue(value);
                const productId = stringValue(row.productId) ?? (["offerId", "ozonSku"].includes(column.key) ? getId(row) : null);
                const label = column.key === "ozonSku" || (column.key === "sku" && row.kind === "ozon" && !productId) ? "SKU Ozon" : "Артикул";
                const article = identifier ? <ProductArticle identifier={identifier} productId={productId} identifierLabel={label} fallback={row} /> : "—";
                return <td key={column.key}>{column.primary ? <span className="table-primary">{article}</span> : article}</td>;
              }
              if (column.key === "article") {
                const articles = orderArticleItems(row.items);
                if (articles.length > 0) return <td key={column.key}><div className="order-article-list">{articles.map((item, articleIndex) => <span className="order-article-item" key={`${item.article}-${articleIndex}`}>
                  <ProductArticle identifier={item.article} productId={item.productId} identifierLabel={item.identifierLabel} fallback={item.details} />
                  <strong>× {displayValue(item.quantity, "quantity")}</strong>
                </span>)}</div></td>;
              }
              if (column.key === "articles") {
                const articles = supplyArticleList(row);
                if (articles) return <td key={column.key}>{articles}</td>;
              }
              if (column.primary) return <td key={column.key}><span className="table-primary">{displayValue(value, displayKind)}</span>{typeof row.sku === "string" && column.key !== "sku" && column.key !== "offerId" && <span className="table-secondary"><ProductArticle identifier={row.sku} productId={stringValue(row.productId)} fallback={row} /></span>}</td>;
              if (column.key === "article") return <td key={column.key}>{orderArticleText(row.items)}</td>;
              const rendered = displayValue(value, displayKind);
              return <td key={column.key} className={column.kind === "money" || column.kind === "quantity" ? "number" : ""}>{column.key.toLowerCase().includes("status") ? <><span className="badge">{rendered}</span>{column.key === "status" && typeof row.returnState === "string" && <span className="table-secondary">{row.returnState}</span>}</> : rendered}</td>;
            })}{(config.deleteUrl || config.editUrl || rowActions) && <td><div className="row-actions">{config.editUrl?.(row) && <button type="button" className="icon-button" aria-label={`Редактировать товар ${index + 1}`} onClick={() => openEdit(row)} disabled={busy}><Pencil size={14} /></button>}{config.deleteUrl?.(row) && <button className="icon-button" aria-label={`Удалить запись ${index + 1}`} onClick={() => void remove(row)} disabled={busy}><Trash2 size={14} /></button>}{rowActions?.(row, refresh)}</div></td>}</tr>)}</tbody></table></div>}
      {pagination && pagination.totalPages > 1 && <nav className="pagination-controls" aria-label={`Страницы: ${config.title}`} aria-busy={loading}>
        {pageItems(pagination.page, pagination.totalPages).map((item, index) => item === "ellipsis"
          ? <span className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
          : <button
            className={`pagination-page ${pagination.page === item ? "active" : ""}`}
            key={item}
            type="button"
            aria-label={`Страница ${item}`}
            aria-current={pagination.page === item ? "page" : undefined}
            aria-disabled={loading || pagination.page === item}
            onClick={() => { if (!loading && pagination.page !== item) setPage(item); }}
          >{item}</button>)}
      </nav>}
    </section>
  </>;
}

export function readObject(value: unknown) { return asRecord(value); }
