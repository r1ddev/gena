"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { TablePagination } from "@/components/table-controls";

type ChangeValue = { before: unknown; after: unknown };
type AuditEvent = {
  id: string;
  occurredAt: string;
  source: string;
  entityType: string;
  action: string;
  recordKey: string;
  changedFields: Record<string, ChangeValue>;
};
type AuditResponse = { items: AuditEvent[]; sources: string[]; page: number; pageSize: number; total: number };

const entityLabels: Record<string, string> = {
  app_settings: "Настройки",
  expenses: "Расходы",
  external_items: "Товары Ozon",
  ozon_finance_accruals: "Начисления Ozon",
  ozon_compensation_reports: "Компенсации Ozon",
  ozon_payouts: "Выплаты Ozon",
  ozon_writeoffs: "Списания Ozon",
  ozon_posting_items: "Товары в заказах",
  ozon_postings: "Заказы Ozon",
  product_links: "Связи товаров",
  products: "Каталог",
  purchase_receipt_lines: "Строки приёмки закупки",
  purchase_receipts: "Приёмки закупок",
  purchases: "Закупки",
  ozon_returns: "Возвраты Ozon",
  scenario_calculations: "Расчёты",
  stock_adjustments: "Изменения остатков",
  stocktake_lines: "Строки инвентаризации",
  stocktakes: "Инвентаризации",
  supplies: "Поставки",
  supply_lines: "Товары в поставках",
  manual_writeoffs: "Списания",
};

const fieldLabels: Record<string, string> = {
  accounting_start_date: "Начало учёта",
  action: "Действие",
  amount: "Сумма",
  accrued_category: "Категория начисления",
  accrual_date: "Дата операции",
  added_cost_rate_percent: "Добавочная стоимость",
  delivered_at: "Дата доставки",
  description: "Описание",
  disposition: "Статус связи",
  landed_unit_cost_snapshot: "Закупочная стоимость с добавочной",
  marketplace: "Площадка",
  note: "Комментарий",
  order_date: "Дата заказа",
  order_number: "Номер заказа",
  order_status: "Статус заказа",
  offer_id: "Артикул",
  ozon_sku: "SKU Ozon",
  ozon_supply_id: "Номер поставки Ozon",
  period_begin: "Начало периода",
  period_end: "Конец периода",
  period_id: "Период выплаты",
  price: "Цена",
  product_id: "Товар",
  product_sku_snapshot: "Артикул товара",
  product_title_snapshot: "Название товара",
  quantity: "Количество",
  report_month: "Месяц отчёта",
  shipping_cost: "Доставка",
  sku: "Артикул",
  source_key: "Источник записи",
  status: "Статус",
  supplied_at: "Дата поставки",
  spent_at: "Дата расхода",
  title: "Название товара",
  type_id: "Тип операции Ozon",
  unit_cost: "Цена за единицу",
};

function friendlyLabel(value: string) {
  return entityLabels[value] ?? value.replaceAll("_", " ");
}

function friendlyField(value: string) {
  return fieldLabels[value] ?? value.replaceAll("_", " ");
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  const result = JSON.stringify(value);
  return result.length > 600 ? `${result.slice(0, 597)}…` : result;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function sourceLabel(source: string) {
  if (source === "gena-web") return "Форма сервиса";
  if (source === "gena-worker") return "Синхронизация Ozon";
  if (source === "gena-migrate") return "Обновление базы";
  return source;
}

function actionLabel(action: string) {
  if (action === "INSERT") return "Добавлено";
  if (action === "UPDATE") return "Изменено";
  if (action === "DELETE") return "Удалено";
  return action;
}

export function AuditLogWorkspace() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);
    if (source) params.set("source", source);
    setLoading(true);
    setError("");

    void fetch(`/api/audit-logs?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as AuditResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить журнал.");
        setItems(body.items);
        setSources(body.sources);
        setTotal(body.total);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить журнал.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, query, source]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  return <section className="panel audit-log-panel">
    <div className="audit-log-filters">
      <form className="audit-log-search" onSubmit={submitSearch}>
        <label className="field">
          <span>Поиск</span>
          <span className="audit-log-search-input"><Search size={15} /><input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Артикул, SKU, ID или поле" /></span>
        </label>
        <button className="button" type="submit">Найти</button>
      </form>
      <label className="field audit-log-source">
        <span>Источник</span>
        <select value={source} onChange={(event) => { setPage(1); setSource(event.target.value); }}>
          <option value="">Все источники</option>
          {sources.map((value) => <option key={value} value={value}>{sourceLabel(value)}</option>)}
        </select>
      </label>
      <div className="audit-log-total">Записей: <strong>{total}</strong></div>
    </div>

    <div className="audit-log-list" aria-busy={loading}>
      {error ? <div className="empty-state"><p className="empty-description">{error}</p></div>
        : loading && items.length === 0 ? <div className="panel-body"><div className="loading-line" /></div>
          : items.length === 0 ? <div className="empty-state"><div><div className="empty-title">Записей пока нет</div><p className="empty-description">Добавления и изменения появятся здесь после сохранения.</p></div></div>
            : items.map((item) => {
              const changes = Object.entries(item.changedFields ?? {});
              return <article className="audit-log-entry" key={item.id}>
                <div className="audit-log-entry-head">
                  <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
                  <span className={`audit-log-source-tag ${item.source === "gena-worker" ? "sync" : "form"}`}>{sourceLabel(item.source)}</span>
                  <strong>{actionLabel(item.action)} · {friendlyLabel(item.entityType)}</strong>
                  {item.recordKey && <code>{item.recordKey}</code>}
                </div>
                <details className="audit-log-details">
                  <summary>Поля: {changes.length}</summary>
                  <div className="audit-log-changes">
                    {changes.map(([field, change]) => <div className="audit-log-change" key={field}>
                      <strong>{friendlyField(field)}</strong>
                      <span>{formatValue(change.before)} <span aria-hidden="true">→</span> {formatValue(change.after)}</span>
                    </div>)}
                  </div>
                </details>
              </article>;
            })}
    </div>

    <TablePagination page={page} pageSize={50} total={total} label="Журнал действий" busy={loading} onPageChange={setPage} />
  </section>;
}
