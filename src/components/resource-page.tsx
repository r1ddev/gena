"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { asRecord, displayValue, findRows, getId, localToday, requestJson, stringValue, valueAt, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";
import { cycleTableSort, filterAndSortRows, paginateRows, TableEmptyRow, TableHead, TablePagination, TABLE_PAGE_SIZE, type TableSort } from "./table-controls";
import { ProductImageInput } from "./product-image-input";
import { notifyProductCatalogChanged, ProductArticle } from "./product-hover-card";
import { ProductSelect, productSelectOptions, type ProductSelectOption } from "./product-select";
import { OzonOrderLink } from "./ozon-order-link";
import { OzonReturnLink } from "./ozon-return-link";
import { ConfirmationModal } from "./confirmation-modal";

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

export type ColumnConfig = { key: string; label: string; kind?: "identifier" | "money" | "quantity" | "percent" | "date" | "status" | "number" | "time" | "text"; primary?: boolean; sortable?: boolean; filterable?: boolean; linkToOzonPosting?: boolean; titleField?: string; value?: (row: JsonRecord) => unknown; render?: (row: JsonRecord, value: unknown) => ReactNode };
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
  filterOptionsUrl?: string;
  showSoldQuantity?: boolean;
  showOrderSummary?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  deleteUrl?: (row: JsonRecord) => string | null;
  deleteConfirm?: string;
  deleteSuccess?: string;
  editUrl?: (row: JsonRecord) => string | null;
  help?: string;
};

type OrderSummary = {
  soldQuantity: number;
  returnQuantity: number;
  returnCount: number;
  purchaseQuantity: number;
  successfulPurchasePercent: number | null;
  successfulDeliveryQuantity: number;
  attemptedDeliveryQuantity: number;
  profitTotal: number;
  profitPostingCount: number;
  profitIncompleteCount: number;
  filteredPostingCount: number;
};

function formatSummaryQuantity(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function formatSummaryPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatSummaryMoney(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ₽`;
}

function formatReturnCount(value: number) {
  const lastTwoDigits = value % 100;
  const lastDigit = value % 10;
  const word = lastTwoDigits >= 11 && lastTwoDigits <= 14 ? "возвратов"
    : lastDigit === 1 ? "возврат"
      : lastDigit >= 2 && lastDigit <= 4 ? "возврата" : "возвратов";
  return `${formatSummaryQuantity(value)} ${word}`;
}

function OrderSummaryCards({ summary, loading, hasActiveFilters }: { summary: OrderSummary | null; loading: boolean; hasActiveFilters: boolean }) {
  const value = (current: number | null | undefined, formatter: (value: number | null | undefined) => string) => loading ? "…" : summary ? formatter(current) : "—";
  const scope = loading ? "Пересчитываю текущую выборку…"
    : `${hasActiveFilters ? "По текущим фильтрам" : "По всей таблице"} · ${formatSummaryQuantity(summary?.filteredPostingCount)} отправлений`;
  const successfulHelp = summary?.successfulPurchasePercent === null || !summary
    ? "Нет отправлений с итоговым статусом"
    : `${formatSummaryQuantity(summary.successfulDeliveryQuantity)} из ${formatSummaryQuantity(summary.attemptedDeliveryQuantity)} шт. со статусом «Доставлен» или «Отменён»`;
  const profitClass = !loading && summary && summary.profitTotal < 0 ? "order-summary-value negative" : "order-summary-value";
  return <section className="sales-summary" aria-label="Итоги по текущей выборке">
    <div className="sales-summary-scope">{scope}</div>
    <div className="sales-summary-grid">
      <article className="panel metric-card sales-summary-card" aria-label="Продано">
        <div className="metric-label">Продано</div>
        <div className="metric-value">{value(summary?.soldQuantity, (current) => `${formatSummaryQuantity(current)} шт.`)}</div>
        <div className="metric-help">Доставлено за вычетом возвратов</div>
      </article>
      <article className="panel metric-card sales-summary-card" aria-label="Возвраты">
        <div className="metric-label">Возвраты</div>
        <div className="metric-value">{value(summary?.returnQuantity, (current) => `${formatSummaryQuantity(current)} шт.`)}</div>
        <div className="metric-help">{loading ? "…" : summary ? formatReturnCount(summary.returnCount) : "—"}</div>
      </article>
      <article className="panel metric-card sales-summary-card" aria-label="Покупки, включая возвраты">
        <div className="metric-label">Покупки, включая возвраты</div>
        <div className="metric-value">{value(summary?.purchaseQuantity, (current) => `${formatSummaryQuantity(current)} шт.`)}</div>
        <div className="metric-help">Продано + возвращено</div>
      </article>
      <article className="panel metric-card sales-summary-card" aria-label="Успешные покупки">
        <div className="metric-label">Успешные покупки</div>
        <div className="metric-value">{value(summary?.successfulPurchasePercent, formatSummaryPercent)}</div>
        <div className="metric-help">{loading ? "…" : successfulHelp}</div>
      </article>
      <article className="panel metric-card sales-summary-card" aria-label="Прибыль после себестоимости">
        <div className="metric-label">Прибыль после себестоимости</div>
        <div className={profitClass}>{value(summary?.profitTotal, (current) => formatSummaryMoney(current ?? 0))}</div>
        <div className="metric-help">{loading ? "…" : summary ? `По ${formatSummaryQuantity(summary.profitPostingCount)} финальным отправлениям${summary.profitIncompleteCount ? ` · ${formatSummaryQuantity(summary.profitIncompleteCount)} без себестоимости` : ""}` : "—"}</div>
      </article>
    </div>
  </section>;
}

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
      <small className="supply-article-costs">
        {line.details.purchaseUnitCostSnapshot == null && line.details.landedUnitCostSnapshot == null
          ? "Стоимость на момент создания не сохранена"
          : `Закупка ${displayValue(line.details.purchaseUnitCostSnapshot, "money")}/шт. · с добавочной ${displayValue(line.details.landedUnitCostSnapshot, "money")}/шт.`}
      </small>
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

function Field({ config, value, onChange, productOptions }: { config: FieldConfig; value: string; onChange: (value: string) => void; productOptions: ProductSelectOption[] }) {
  const type = config.type ?? "text";
  const fieldClass = config.wide ? "field wide" : "field";
  if (type === "textarea") return <div className={fieldClass}><label htmlFor={config.name}>{config.label}</label><textarea id={config.name} value={value} placeholder={config.placeholder} required={config.required} onChange={(event) => onChange(event.target.value)} /></div>;
  if (config.optionsFrom === "/api/products") return <div className={fieldClass}><label htmlFor={config.name}>{config.label}</label><ProductSelect id={config.name} value={value} products={productOptions} required={config.required} onChange={onChange} /></div>;
  if (type === "select") {
    const options = config.options ?? [];
    return <div className={fieldClass}><label htmlFor={config.name}>{config.label}</label><select id={config.name} value={value} required={config.required} onChange={(event) => onChange(event.target.value)}><option value="">Выберите…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
  }
  return <div className={fieldClass}><label htmlFor={config.name}>{config.label}</label><input id={config.name} type={type} value={value} required={config.required} min={config.min ?? (type === "number" ? "0" : undefined)} step={config.step} placeholder={config.placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

export function ResourcePage({ config, actions, beforeTable, refreshKey, rowActions, onMutation }: { config: ResourceConfig; actions?: React.ReactNode; beforeTable?: React.ReactNode; refreshKey?: string | number; rowActions?: (row: JsonRecord, refresh: () => Promise<void>) => React.ReactNode; onMutation?: () => void }) {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [pagination, setPagination] = useState<{ page: number; pageSize: number; total: number; totalPages: number } | null>(null);
  const [soldQuantity, setSoldQuantity] = useState<number | null>(null);
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [editingRow, setEditingRow] = useState<JsonRecord | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [productImage, setProductImage] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [productOptions, setProductOptions] = useState<ProductSelectOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<{ url: string; title: string; description: string } | null>(null);
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [serverFilters, setServerFilters] = useState<Record<string, string>>({});
  const [serverFilterOptions, setServerFilterOptions] = useState<Record<string, string[]>>({});
  const [activeCellTooltip, setActiveCellTooltip] = useState<string | null>(null);
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
      const orderSummaryFields = summary ? {
        soldQuantity: summary.soldQuantity,
        returnQuantity: summary.returnQuantity,
        returnCount: summary.returnCount,
        purchaseQuantity: summary.purchaseQuantity,
        successfulPurchasePercent: summary.successfulPurchasePercent,
        successfulDeliveryQuantity: summary.successfulDeliveryQuantity,
        attemptedDeliveryQuantity: summary.attemptedDeliveryQuantity,
        profitTotal: summary.profitTotal,
        profitPostingCount: summary.profitPostingCount,
        profitIncompleteCount: summary.profitIncompleteCount,
        filteredPostingCount: summary.filteredPostingCount,
      } : null;
      setOrderSummary(orderSummaryFields &&
        typeof orderSummaryFields.soldQuantity === "number" && Number.isFinite(orderSummaryFields.soldQuantity) &&
        typeof orderSummaryFields.returnQuantity === "number" && Number.isFinite(orderSummaryFields.returnQuantity) &&
        typeof orderSummaryFields.returnCount === "number" && Number.isFinite(orderSummaryFields.returnCount) &&
        typeof orderSummaryFields.purchaseQuantity === "number" && Number.isFinite(orderSummaryFields.purchaseQuantity) &&
        (orderSummaryFields.successfulPurchasePercent === null || typeof orderSummaryFields.successfulPurchasePercent === "number" && Number.isFinite(orderSummaryFields.successfulPurchasePercent)) &&
        typeof orderSummaryFields.successfulDeliveryQuantity === "number" && Number.isFinite(orderSummaryFields.successfulDeliveryQuantity) &&
        typeof orderSummaryFields.attemptedDeliveryQuantity === "number" && Number.isFinite(orderSummaryFields.attemptedDeliveryQuantity) &&
        typeof orderSummaryFields.profitTotal === "number" && Number.isFinite(orderSummaryFields.profitTotal) &&
        typeof orderSummaryFields.profitPostingCount === "number" && Number.isFinite(orderSummaryFields.profitPostingCount) &&
        typeof orderSummaryFields.profitIncompleteCount === "number" && Number.isFinite(orderSummaryFields.profitIncompleteCount) &&
        typeof orderSummaryFields.filteredPostingCount === "number" && Number.isFinite(orderSummaryFields.filteredPostingCount)
        ? orderSummaryFields as OrderSummary : null);
      const remotePage = asRecord(asRecord(result)?.pagination);
      if (remotePage && typeof remotePage.page === "number" && typeof remotePage.pageSize === "number" && typeof remotePage.total === "number" && typeof remotePage.totalPages === "number") {
        setPagination({ page: remotePage.page, pageSize: remotePage.pageSize, total: remotePage.total, totalPages: remotePage.totalPages });
        if (remotePage.page !== page) setPage(remotePage.page);
      } else setPagination(null);
    }
    catch (reason) {
      if (sequence === requestSequence.current) {
        setRows([]); setPagination(null); setSoldQuantity(null); setOrderSummary(null); setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить список");
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
      if (config.showOrderSummary) setOrderSummary(null);
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
  const loadServerFilterOptions = useCallback(async () => {
    if (!config.filterOptionsUrl) return;
    try {
      const response = await requestJson(config.filterOptionsUrl);
      const options = asRecord(asRecord(response)?.filterOptions);
      if (!options) return;
      const normalized = Object.fromEntries(Object.entries(options).flatMap(([key, value]) =>
        Array.isArray(value) ? [[key, value.filter((option): option is string => typeof option === "string")]] : [],
      ));
      setServerFilterOptions(normalized);
    } catch {
      // The current page values still provide useful suggestions if the full list is unavailable.
    }
  }, [config.filterOptionsUrl]);
  useEffect(() => {
    if (!config.filterOptionsUrl) return;
    void loadServerFilterOptions();
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, loadServerFilterOptions);
    return () => window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, loadServerFilterOptions);
  }, [config.filterOptionsUrl, loadServerFilterOptions, refreshKey]);
  useEffect(() => {
    if (config.fields.some((field) => field.optionsFrom === "/api/products")) {
      requestJson("/api/products").then((value) => setProductOptions(productSelectOptions(value))).catch(() => setProductOptions([]));
    }
  }, [config.fields]);

  const visibleRows = useMemo(() => {
    if (config.remotePageSize) return rows;
    const query = search.trim().toLocaleLowerCase("ru-RU");
    const filteredAndSorted = filterAndSortRows(rows, config.columns, filters, sort);
    if (!query) return filteredAndSorted;
    return filteredAndSorted.filter((row) => JSON.stringify(row).toLocaleLowerCase("ru-RU").includes(query));
  }, [config.columns, config.remotePageSize, filters, rows, search, sort]);
  const localPagination = useMemo(() => paginateRows(visibleRows, page), [visibleRows, page]);
  const pageRows = config.remotePageSize ? visibleRows : localPagination.rows;
  const tablePage = config.remotePageSize ? pagination?.page ?? page : localPagination.page;
  const tablePageSize = config.remotePageSize ? pagination?.pageSize ?? config.remotePageSize : TABLE_PAGE_SIZE;
  const tableTotal = config.remotePageSize ? pagination?.total ?? 0 : visibleRows.length;
  const tableColumns = useMemo(() => config.columns.map((column) => ({
    ...column,
    kind: column.kind ?? (column.key === "id" || column.key === "externalId" ? "identifier" : "text"),
    value: column.value ?? (column.key === "article" ? (row: JsonRecord) => orderArticleText(row.items)
      : column.key === "status" ? (row: JsonRecord) => [row.status, row.returnState].filter(Boolean).join(" ")
        : (row: JsonRecord) => valueAt(row, column.key)),
  })), [config.columns]);

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function updateSort(key: string) {
    setSort((current) => cycleTableSort(current, key));
    setPage(1);
  }

  function clearTableFilters() {
    setFilters({});
    setSearch("");
    setPage(1);
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
      setSuccess(editing ? "Изменения сохранены." : "Запись добавлена. Связанные итоги обновлены автоматически."); onMutation?.(); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить запись"); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) { await submitRecord(event, false); }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) { await submitRecord(event, true); }

  function remove(row: JsonRecord) {
    if (!config.deleteUrl) return;
    const url = config.deleteUrl(row);
    if (!url) return;
    setDeletePrompt({
      url,
      title: String(row.title ?? row.sku ?? "запись"),
      description: config.deleteConfirm ?? "Связанные остатки и итоги обновятся автоматически.",
    });
  }

  async function confirmRemove() {
    if (!deletePrompt) return;
    const pendingDelete = deletePrompt;
    setDeletePrompt(null);
    setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson(pendingDelete.url, { method: "DELETE" });
      if (config.collectionUrl === "/api/products") notifyProductCatalogChanged();
      setSuccess(config.deleteSuccess ?? "Запись удалена. Связанные итоги обновлены автоматически.");
      onMutation?.(); await refresh();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить запись"); }
    finally { setBusy(false); }
  }

  const hasProductSelect = config.fields.some((field) => field.optionsFrom);
  const hasActiveFilters = Boolean(search.trim() || serverSearch.trim() || Object.values(filters).some((value) => value.trim()) || Object.values(serverFilters).some((value) => value.trim()));
  const tableColumnCount = config.columns.length + (config.deleteUrl || config.editUrl || rowActions ? 1 : 0);
  return <>
    <PageHeader eyebrow={config.eyebrow ?? "Учёт операций"} title={config.title} description={config.description} actions={<div className="toolbar">{actions}{!config.hideCreate && <button className="button" onClick={() => { setFormOpen((open) => !open); setError(""); setSuccess(""); }}><Plus size={15} />{formOpen ? "Закрыть форму" : config.createLabel}</button>}</div>} />
    {config.showOrderSummary && <OrderSummaryCards summary={orderSummary} loading={loading} hasActiveFilters={hasActiveFilters} />}
    {!config.showOrderSummary && config.showSoldQuantity && <section className="panel metric-card" style={{ "--metric-bg": "#eef5fa", marginBottom: 16 } as React.CSSProperties} aria-label="Проданные товары"><Package className="metric-icon" size={18} /><div className="metric-label">Продано товаров</div><div className="metric-value">{soldQuantity === null ? loading ? "…" : "—" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(soldQuantity)} шт.`}</div><div className="metric-help">Доставленные и выкупленные Ozon товары за всё время, за вычетом возвратов</div></section>}
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
        <div className="panel-head"><div><h2 id="product-edit-title">Редактирование записи</h2><span className="small-note">Поля со звёздочкой обязательны</span></div><button type="button" className="icon-button" aria-label="Закрыть редактирование" onClick={closeEdit}><X size={15} /></button></div>
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
    <ConfirmationModal
      open={Boolean(deletePrompt)}
      title="Удалить запись?"
      description={deletePrompt?.description ?? ""}
      confirmLabel="Удалить"
      busy={busy}
      onCancel={() => setDeletePrompt(null)}
      onConfirm={() => void confirmRemove()}
    />
    {beforeTable}
    <section className="panel">
      <div className="panel-head"><div><h2>Список записей</h2><span className="small-note">{loading ? "Загружаем список…" : config.remotePageSize ? `${pagination?.total ?? 0} записей` : `${visibleRows.length} ${visibleRows.length === 1 ? "запись" : "записей"}`}</span></div><div className="toolbar"><div className="search-box"><Search size={14} /><input aria-label="Поиск по таблице" placeholder={config.remotePageSize ? "Поиск по заказам" : "Поиск"} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div></div></div>
      {loading && rows.length === 0 && !hasActiveFilters ? <div className="panel-body" aria-label="Загрузка списка"><div className="loading-line" /><div style={{ height: 10 }} /><div className="loading-line" /><div style={{ height: 10 }} /><div className="loading-line" /></div>
        : loadError && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={20} /></div><div className="empty-title">Не удалось загрузить данные</div><p className="empty-description">{loadError}</p><button className="button secondary" style={{ marginTop: 13 }} onClick={() => void refresh()}>Повторить</button></div></div>
          : rows.length === 0 && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><Package size={20} /></div><div className="empty-title">{config.emptyTitle ?? "Пока нет записей"}</div><p className="empty-description">{config.emptyDescription ?? "Добавьте первую запись — она появится в этом списке, а связанные итоги обновятся автоматически."}</p></div></div>
            : <div className="table-wrap"><table><TableHead columns={tableColumns} rows={rows} filterOptions={serverFilterOptions} filters={filters} onFilter={updateFilter} sort={sort} onSort={updateSort} trailingHeaders={config.deleteUrl || config.editUrl || rowActions ? ["Действия"] : []} /><tbody>{loadError ? <TableEmptyRow colSpan={tableColumnCount} message={loadError} /> : config.remotePageSize && loading ? <TableEmptyRow colSpan={tableColumnCount} message="Обновляем список…" /> : visibleRows.length === 0 ? <TableEmptyRow colSpan={tableColumnCount} message="По заданным условиям совпадений нет." onClear={clearTableFilters} /> : pageRows.map((row, index) => <tr key={getId(row) ?? index}>{config.columns.map((column) => {
              const value = column.value ? column.value(row) : valueAt(row, column.key);
              const displayKind = column.kind === "date" || column.kind === "money" || column.kind === "quantity" || column.kind === "percent" || column.kind === "status" ? column.kind : undefined;
              if (column.render) return <td key={column.key}>{column.render(row, value)}</td>;
              if (["sku", "offerId", "ozonSku"].includes(column.key)) {
                const identifier = stringValue(value);
                const productId = stringValue(row.productId) ?? (["offerId", "ozonSku"].includes(column.key) ? getId(row) : null);
                const label = column.key === "ozonSku" || (column.key === "sku" && row.kind === "ozon" && !productId && !stringValue(row.offerId)) ? "SKU Ozon" : "Артикул";
                const article = identifier ? <ProductArticle identifier={identifier} productId={productId} identifierLabel={label} fallback={row} /> : "—";
                return <td key={column.key}>{column.primary ? <span className="table-primary">{article}</span> : article}</td>;
              }
              if (column.linkToOzonPosting) {
                const postingNumber = stringValue(value);
                const orderLink = postingNumber ? <OzonOrderLink postingNumber={postingNumber} /> : "—";
                return <td key={column.key}>{column.primary ? <span className="table-primary">{orderLink}</span> : orderLink}</td>;
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
              if (column.key.toLowerCase().includes("status")) return <td key={column.key}>
                <span className="badge">{rendered}</span>
                {column.key === "status" && typeof row.returnState === "string" && <span className="table-secondary">{row.returnState}</span>}
                {column.key === "status" && Array.isArray(row.returnRecords) && row.returnRecords.map((candidate, returnIndex) => {
                  const returnId = stringValue(asRecord(candidate)?.externalId);
                  return returnId ? <span className="table-secondary" key={`${returnId}-${returnIndex}`}><OzonReturnLink returnId={returnId}>Возврат {returnId}</OzonReturnLink></span> : null;
                })}
              </td>;
              if (column.key === "amount" && Array.isArray(row.returnRecords) && row.returnRecords.length > 0 && typeof row.returnCost === "number") return <td key={column.key} className="number">
                <span>{rendered}</span>
                <span className="table-secondary">Расходы на возврат: {displayValue(row.returnCost, "money")}</span>
              </td>;
              const title = column.titleField ? stringValue(row[column.titleField]) ?? undefined : undefined;
              if (column.titleField && title) {
                const tooltipKey = `${stringValue(row.externalId) ?? stringValue(row.id) ?? index}-${column.key}`;
                const isOpen = activeCellTooltip === tooltipKey;
                return <td key={column.key} title={title} className={column.kind === "money" || column.kind === "quantity" || column.kind === "percent" ? "number" : ""}>
                  <button type="button" className="table-tooltip-trigger" aria-label={`Показать пояснение: ${rendered}`} aria-expanded={isOpen} onClick={() => setActiveCellTooltip(isOpen ? null : tooltipKey)}>{rendered}</button>
                  {isOpen && <span className="table-secondary table-cell-tooltip" role="tooltip">{title}</span>}
                </td>;
              }
              return <td key={column.key} title={title} className={column.kind === "money" || column.kind === "quantity" || column.kind === "percent" ? "number" : ""}>{rendered}</td>;
            })}{(config.deleteUrl || config.editUrl || rowActions) && <td><div className="row-actions">{config.editUrl?.(row) && <button type="button" className="icon-button" aria-label={`Редактировать запись ${index + 1}`} onClick={() => openEdit(row)} disabled={busy}><Pencil size={14} /></button>}{config.deleteUrl?.(row) && <button className="icon-button" aria-label={`Удалить запись ${index + 1}`} onClick={() => void remove(row)} disabled={busy}><Trash2 size={14} /></button>}{rowActions?.(row, refresh)}</div></td>}</tr>)}</tbody></table></div>}
      <TablePagination page={tablePage} pageSize={tablePageSize} total={tableTotal} label={config.title} busy={loading} onPageChange={setPage} />
    </section>
  </>;
}

export function readObject(value: unknown) { return asRecord(value); }
