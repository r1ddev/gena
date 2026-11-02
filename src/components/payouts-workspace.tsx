"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { asRecord, findRows, requestJson, type JsonRecord } from "@/components/api";
import { OZON_SYNC_COMPLETED_EVENT } from "@/components/ozon-sync-events";
import { OzonOrderLink } from "@/components/ozon-order-link";
import { TableEmptyRow, TablePagination, TABLE_PAGE_SIZE, paginateRows } from "@/components/table-controls";

type PayoutRow = JsonRecord & {
  id: string;
  periodBegin: string;
  periodEnd: string;
  currencyCode: string;
  amount: string;
  detailsLoaded: boolean;
};

const moneyFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "short", year: "numeric" });

function money(value: unknown, currencyCode = "RUB") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const prefix = amount > 0 ? "+" : amount < 0 ? "−" : "";
  const suffix = currencyCode === "RUB" ? "₽" : currencyCode;
  return `${prefix}${moneyFormatter.format(Math.abs(amount))} ${suffix}`;
}

function periodDate(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? dateFormatter.format(parsed) : value;
}

function dateRangeLabel(from: string, to: string) {
  return from === to ? periodDate(from) : `${periodDate(from)} — ${periodDate(to)}`;
}

function isInDateRange(row: PayoutRow, from: string, to: string) {
  return (!from || row.periodEnd >= from) && (!to || row.periodBegin <= to);
}

function filterText(row: PayoutRow) {
  const statement = asRecord(row.statement);
  const categories = Array.isArray(statement?.categories) ? statement.categories : [];
  const groupNames = Array.isArray(statement?.serviceGroups) ? statement.serviceGroups : [];
  const labels = [...categories, ...groupNames].map((value) => {
    const item = asRecord(value);
    return `${String(item?.label ?? "")} ${String(item?.amount ?? "")}`;
  });
  return [row.periodBegin, row.periodEnd, row.amount, row.currencyCode, row.searchText, ...labels].join(" ").toLocaleLowerCase("ru-RU");
}

function DetailPanel({ item }: { item: JsonRecord }) {
  const statement = asRecord(item.statement) ?? {};
  const reconciliation = asRecord(item.reconciliation) ?? {};
  const categories = Array.isArray(statement.categories) ? statement.categories.map(asRecord).filter((row): row is JsonRecord => row !== null) : [];
  const serviceGroups = Array.isArray(statement.serviceGroups) ? statement.serviceGroups.map(asRecord).filter((row): row is JsonRecord => row !== null) : [];
  const operations = Array.isArray(item.operations) ? item.operations.map(asRecord).filter((row): row is JsonRecord => row !== null) : [];
  const currencyCode = typeof item.currencyCode === "string" ? item.currencyCode : "RUB";

  return <div className="payout-detail">
    <div className="payout-detail-totals">
      <div><span>Перевод по отчёту Ozon</span><strong>{money(item.amount, currencyCode)}</strong></div>
      <div><span>Начисления за эти даты</span><strong>{money(reconciliation.accrualsAmount, currencyCode)}</strong></div>
      {reconciliation.difference !== null && reconciliation.difference !== undefined && <div><span>Разница между суммами</span><strong>{money(reconciliation.difference, currencyCode)}</strong></div>}
    </div>
    <p className="payout-detail-note">В отчёте выплаты нет списка отправлений. Ниже показаны начисления Ozon за те же даты; это отдельная детализация, а не точная расшифровка перевода по товарам.</p>

    <div className="payout-detail-grid">
      <section className="payout-detail-section">
        <h3>Состав отчёта Ozon</h3>
        {categories.length ? <div className="payout-breakdown-list">{categories.map((category) => <div className="payout-breakdown-row" key={String(category.key)}>
          <span>{String(category.label)}</span><strong>{money(category.amount, currencyCode)}</strong>
        </div>)}</div> : <p className="small-note">Расшифровка отчёта ещё не загружена. Нажмите «Обновить расшифровки» сверху.</p>}
        {(statement.beginBalance !== null || statement.endBalance !== null) && <div className="payout-balance-note">
          {statement.beginBalance !== null && <span>Баланс на начало: {money(statement.beginBalance, currencyCode)}</span>}
          {statement.endBalance !== null && <span>Баланс на конец: {money(statement.endBalance, currencyCode)}</span>}
        </div>}
      </section>

      {serviceGroups.length > 0 && <section className="payout-detail-section">
        <h3>Услуги и дополнительные суммы</h3>
        {serviceGroups.map((group) => {
          const rows = Array.isArray(group.items) ? group.items.map(asRecord).filter((row): row is JsonRecord => row !== null) : [];
          return <div className="payout-service-group" key={String(group.key)}>
            <div className="payout-breakdown-row"><strong>{String(group.label)}</strong><strong>{group.total === null ? "—" : money(group.total, currencyCode)}</strong></div>
            {rows.map((service, index) => <div className="payout-service-item" key={`${String(service.label)}-${index}`}>
              <span>{String(service.label)}</span><span>{money(service.amount, currencyCode)}</span>
            </div>)}
          </div>;
        })}
      </section>}
    </div>

    <section className="payout-detail-section payout-operations-section">
      <div className="payout-detail-title-row">
        <div><h3>Начисления по отправлениям и товарам</h3><span className="small-note">{operations.length} операций за этот период</span></div>
        <div className="payout-detail-totals-compact">
          <span>Товары каталога: <strong>{money(reconciliation.catalogAccrualsAmount, currencyCode)}</strong></span>
          <span>Вне каталога: <strong>{money(reconciliation.outsideCatalogAmount, currencyCode)}</strong></span>
          <span>Без товара: <strong>{money(reconciliation.unlinkedAmount, currencyCode)}</strong></span>
        </div>
      </div>
      <div className="table-wrap payout-operations-table-wrap">
        <table className="payout-operations-table">
          <thead><tr><th>Дата</th><th>Операция</th><th>Товар / SKU</th><th>Отправление</th><th>Сумма</th><th>Связь</th></tr></thead>
          <tbody>{operations.length ? operations.map((operation) => {
            const productRows = Array.isArray(operation.products) ? operation.products.map(asRecord).filter((row): row is JsonRecord => row !== null) : [];
            const postingNumber = typeof operation.postingNumber === "string" ? operation.postingNumber : "";
            const relatedSkus = Array.isArray(operation.relatedSkus) ? operation.relatedSkus.map(String) : [];
            return <tr key={String(operation.id)}>
              <td>{periodDate(String(operation.accrualDate ?? ""))}</td>
              <td><strong>{String(operation.operation ?? "Операция Ozon")}</strong>{Boolean(operation.typeId) && <small>Код {String(operation.typeId)}</small>}</td>
              <td>{productRows.length ? productRows.map((product) => <span className="payout-product-line" key={`${String(product.ozonSku)}-${String(product.article)}`}>
                <strong>{String(product.title)}</strong>
                <small>{product.article ? `Артикул ${String(product.article)} · ` : ""}SKU Ozon {String(product.ozonSku)}{product.inCatalog ? " · в каталоге" : " · вне каталога"}</small>
              </span>) : relatedSkus.length ? `SKU Ozon ${relatedSkus.join(", ")}` : "Без привязки к товару"}</td>
              <td>{postingNumber ? <OzonOrderLink postingNumber={postingNumber}>{postingNumber}</OzonOrderLink> : String(operation.unitNumber || "—")}</td>
              <td className="number">{money(operation.amount, currencyCode)}</td>
              <td><span className={`payout-link-status ${String(operation.productStatus) === "Товар в каталоге" || String(operation.productStatus) === "Смешанная отправка" ? "in-catalog" : ""}`}>{String(operation.productStatus)}</span></td>
            </tr>;
          }) : <TableEmptyRow colSpan={6} message="За эти даты начислений Ozon нет." />}</tbody>
        </table>
      </div>
    </section>
  </div>;
}

export function PayoutsWorkspace() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [details, setDetails] = useState<Record<string, JsonRecord>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = asRecord(await requestJson("/api/payouts"));
      setRows(findRows(response) as PayoutRow[]);
      setDetails({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить выплаты.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const refreshAfterSync = () => { void refresh(); };
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    return () => window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
  }, []);

  const visibleRows = useMemo(() => rows.filter((row) =>
    isInDateRange(row, dateFrom, dateTo) && filterText(row).includes(search.trim().toLocaleLowerCase("ru-RU"))), [rows, dateFrom, dateTo, search]);
  const pageRows = paginateRows(visibleRows, page, TABLE_PAGE_SIZE);

  async function toggleDetails(row: PayoutRow) {
    if (expandedId === row.id) {
      setExpandedId("");
      return;
    }
    setExpandedId(row.id);
    if (details[row.id] || loadingDetails[row.id]) return;
    setLoadingDetails((current) => ({ ...current, [row.id]: true }));
    try {
      const response = asRecord(await requestJson(`/api/payouts?id=${encodeURIComponent(row.id)}`));
      const detail = asRecord(response?.item);
      if (!detail) throw new Error("Не удалось открыть состав выплаты.");
      setDetails((current) => ({ ...current, [row.id]: detail }));
    } catch (reason) {
      setDetails((current) => ({ ...current, [row.id]: { error: reason instanceof Error ? reason.message : "Не удалось загрузить состав выплаты." } }));
    } finally {
      setLoadingDetails((current) => ({ ...current, [row.id]: false }));
    }
  }

  return <section className="panel payouts-panel">
    <div className="panel-head payouts-list-head">
      <div><h2>Список выплат</h2><span className="small-note">{loading ? "Загружаем…" : `${visibleRows.length} периодов`}</span></div>
      <label className="search-box" aria-label="Поиск по выплатам"><Search size={14} /><input placeholder="Поиск по периоду или сумме" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
    </div>
    <div className="payout-date-filters">
      <label>Период от<input type="date" aria-label="Период от" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label>
      <label>Период до<input type="date" aria-label="Период до" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label>
      {(search || dateFrom || dateTo) && <button className="button secondary" type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setPage(1); }}>Сбросить фильтры</button>}
    </div>
    <div className="table-wrap payouts-table-wrap">
      <table className="payouts-table">
        <thead><tr><th>Период отчёта Ozon</th><th>Перевод Ozon</th><th>Состав отчёта</th><th></th></tr></thead>
        <tbody>{error ? <TableEmptyRow colSpan={4} message={error} />
          : loading && rows.length === 0 ? <TableEmptyRow colSpan={4} message="Загружаем выплаты…" />
            : pageRows.rows.length ? pageRows.rows.map((row) => {
              const statement = asRecord(row.statement);
              const categories = Array.isArray(statement?.categories) ? statement.categories.length : 0;
              const isExpanded = expandedId === row.id;
              const detail = details[row.id];
              return <Fragment key={row.id}>
                <tr className="payout-summary-row">
                  <td><strong>{dateRangeLabel(row.periodBegin, row.periodEnd)}</strong></td>
                  <td className="number payout-amount">{money(row.amount, row.currencyCode)}</td>
                  <td>{row.detailsLoaded ? `${categories} статей отчёта · ${Number(row.operationCount ?? 0)} операций` : `${Number(row.operationCount ?? 0)} начислений · расшифровку нужно загрузить`}</td>
                  <td><button className="button secondary payout-open-button" type="button" aria-expanded={isExpanded} onClick={() => void toggleDetails(row)}>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{isExpanded ? "Скрыть" : "За что"}</button></td>
                </tr>
                {isExpanded && <tr className="payout-expanded-row"><td colSpan={4}>
                  {loadingDetails[row.id] ? <p className="small-note">Загружаем состав выплаты…</p>
                    : detail?.error ? <p className="payout-load-error" role="alert">{String(detail.error)}</p>
                      : detail ? <DetailPanel item={detail} />
                        : <p className="small-note">Загружаем состав выплаты…</p>}
                </td></tr>}
              </Fragment>;
            }) : <TableEmptyRow colSpan={4} message="За выбранный период выплат нет." />}</tbody>
      </table>
    </div>
    <TablePagination page={pageRows.page} pageSize={TABLE_PAGE_SIZE} total={visibleRows.length} label="Выплаты Ozon" busy={loading} onPageChange={setPage} />
  </section>;
}
