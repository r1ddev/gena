"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { asRecord, findRows, requestJson, type JsonRecord } from "@/components/api";
import { OZON_SYNC_COMPLETED_EVENT } from "@/components/ozon-sync-events";
import { TableEmptyRow, TablePagination, TABLE_PAGE_SIZE, paginateRows } from "@/components/table-controls";

type PayoutAnalysis = {
  salesWeekBegin: string;
  salesWeekEnd: string;
  lagDays: number;
  currentCatalogAmount: number;
  outsideCatalogAmount: number;
  unlinkedAmount: number;
  accrualAmount: number;
  difference: number;
  status: "matched" | "different" | "no_activity";
  totalRows: number;
  currentCatalogRows: number;
  outsideCatalogRows: number;
  unlinkedRows: number;
  mixedRows: number;
  mixedCatalogAmount: number;
  currentProductTitles: string[];
  outsideIdentifiers: string[];
  productBreakdown: { title: string; article: string; amount: number; rows: number }[];
};

type PayoutManualScope = "current" | "old" | "mixed" | "unknown" | null;

type PayoutRow = JsonRecord & {
  id: string;
  periodBegin: string;
  periodEnd: string;
  currencyCode: string;
  amount: string;
  manualScope: PayoutManualScope;
  analysis: PayoutAnalysis;
};

type PayoutFilter = "all" | "catalog" | "outside" | "unknown" | "matched" | "different";

const moneyFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "short", year: "numeric" });

function money(value: unknown, currencyCode = "RUB") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const suffix = currencyCode === "RUB" ? "₽" : currencyCode;
  return `${amount < 0 ? "−" : ""}${moneyFormatter.format(Math.abs(amount))} ${suffix}`;
}

function signedMoney(value: unknown, currencyCode = "RUB") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${moneyFormatter.format(Math.abs(amount))} ${currencyCode === "RUB" ? "₽" : currencyCode}`;
}

function periodDate(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? dateFormatter.format(parsed) : value;
}

function dateRangeLabel(from: string, to: string) {
  return from === to ? periodDate(from) : `${periodDate(from)} – ${periodDate(to)}`;
}

function isInDateRange(row: PayoutRow, from: string, to: string) {
  return (!from || row.periodEnd >= from) && (!to || row.periodBegin <= to);
}

function matchesFilter(row: PayoutRow, filter: PayoutFilter) {
  const hasCatalog = row.manualScope
    ? row.manualScope === "current" || row.manualScope === "mixed"
    : row.analysis.currentCatalogRows > 0;
  const hasOutside = row.manualScope
    ? row.manualScope === "old" || row.manualScope === "mixed"
    : row.analysis.outsideCatalogRows > 0 || row.analysis.mixedRows > 0;
  const hasUnknown = row.manualScope
    ? row.manualScope === "unknown"
    : !row.analysis.currentCatalogRows && !row.analysis.outsideCatalogRows;
  if (filter === "catalog") return hasCatalog;
  if (filter === "outside") return hasOutside;
  if (filter === "unknown") return hasUnknown;
  if (filter === "matched") return row.analysis.status === "matched";
  if (filter === "different") return row.analysis.status !== "matched";
  return true;
}

function filterText(row: PayoutRow) {
  return [
    row.periodBegin,
    row.periodEnd,
    row.analysis.salesWeekBegin,
    row.analysis.salesWeekEnd,
    row.amount,
    row.currencyCode,
    manualScopeLabel(row.manualScope),
    ...row.analysis.currentProductTitles,
    ...row.analysis.outsideIdentifiers,
  ].join(" ").toLocaleLowerCase("ru-RU");
}

function manualScopeLabel(scope: PayoutManualScope) {
  if (scope === "current") return "Отмечено: текущие товары";
  if (scope === "old") return "Отмечено: старые товары";
  if (scope === "mixed") return "Отмечено: смешанная выплата";
  if (scope === "unknown") return "Отмечено: не определено";
  return "";
}

function compositionLabel(row: PayoutRow) {
  const { analysis } = row;
  if (row.manualScope) return manualScopeLabel(row.manualScope);
  if (analysis.currentCatalogRows && (analysis.outsideCatalogRows || analysis.mixedRows)) return "Каталог и SKU вне каталога";
  if (analysis.currentCatalogRows) return "Есть товары каталога";
  if (analysis.outsideCatalogRows) return "SKU вне каталога";
  if (analysis.unlinkedRows) return "Без привязки к товару";
  return "Не удалось определить";
}

function reconciliationLabel(status: PayoutAnalysis["status"]) {
  if (status === "matched") return "Сумма совпала";
  if (status === "different") return "Сумма отличается";
  return "Нет данных в сервисе";
}

export function PayoutsWorkspace() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingManualId, setSavingManualId] = useState("");
  const [manualError, setManualError] = useState<{ id: string; message: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = asRecord(await requestJson("/api/payouts"));
      setRows(findRows(response) as PayoutRow[]);
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
    isInDateRange(row, dateFrom, dateTo) && matchesFilter(row, payoutFilter) && filterText(row).includes(search.trim().toLocaleLowerCase("ru-RU"))),
  [rows, dateFrom, dateTo, payoutFilter, search]);
  const pageRows = paginateRows(visibleRows, page, TABLE_PAGE_SIZE);

  function resetPage(action: () => void) {
    action();
    setPage(1);
  }

  async function saveManualScope(row: PayoutRow, scope: PayoutManualScope) {
    setSavingManualId(row.id);
    setManualError(null);
    try {
      await requestJson("/api/payouts", { method: "PATCH", body: JSON.stringify({ id: row.id, manualScope: scope }) });
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, manualScope: scope } : item));
    } catch (reason) {
      setManualError({ id: row.id, message: reason instanceof Error ? reason.message : "Не удалось сохранить отметку." });
    } finally {
      setSavingManualId("");
    }
  }

  return <section className="panel payouts-panel">
    <div className="payout-explanation">
      <strong>Как определяется неделя продаж</strong>
      <p>Ozon считает продажи за неделю с понедельника по воскресенье, затем ещё 14 дней учитывает возвраты и корректировки и перечисляет деньги в течение 7 рабочих дней. Здесь сравниваются начисления за неделю, начавшуюся за 28 дней до недели отчёта. Это оценка по графику, а не прямая привязка выплаты к товарам в API.</p>
      <p>Если сумма начислений за эту неделю равна переводу, сервис так и отмечает. Если нет — показывает разницу.</p>
    </div>
    <div className="panel-head payouts-list-head">
      <div><h2>Список переводов</h2><span className="small-note">{loading ? "Загружаем…" : `Переводов: ${visibleRows.length}`}</span></div>
      <label className="search-box" aria-label="Поиск по переводам"><Search size={14} /><input placeholder="Период, сумма, товар или SKU" value={search} onChange={(event) => resetPage(() => setSearch(event.target.value))} /></label>
    </div>
    <div className="payout-date-filters">
      <label>Период отчёта от<input type="date" aria-label="Период отчёта от" value={dateFrom} onChange={(event) => resetPage(() => setDateFrom(event.target.value))} /></label>
      <label>Период отчёта до<input type="date" aria-label="Период отчёта до" value={dateTo} onChange={(event) => resetPage(() => setDateTo(event.target.value))} /></label>
      <label>Состав выплаты<select aria-label="Состав выплаты" value={payoutFilter} onChange={(event) => resetPage(() => setPayoutFilter(event.target.value as PayoutFilter))}>
        <option value="all">Все</option>
        <option value="catalog">Есть товары из каталога</option>
        <option value="outside">Есть SKU вне каталога</option>
        <option value="unknown">Не удалось определить состав</option>
        <option value="matched">Сумма совпала</option>
        <option value="different">Сумма не совпала</option>
      </select></label>
      {(search || dateFrom || dateTo || payoutFilter !== "all") && <button className="button secondary" type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setPayoutFilter("all"); setPage(1); }}>Сбросить фильтры</button>}
    </div>
    <div className="table-wrap payouts-table-wrap">
      <table className="payouts-table">
        <thead><tr><th>Период отчёта Ozon</th><th>Перевод</th><th>Предполагаемая неделя начислений</th><th>Сверка</th></tr></thead>
        <tbody>{error ? <TableEmptyRow colSpan={4} message={error} />
          : loading && rows.length === 0 ? <TableEmptyRow colSpan={4} message="Загружаем выплаты…" />
            : pageRows.rows.length ? pageRows.rows.map((row) => {
              const isExpanded = expandedId === row.id;
              const { analysis } = row;
              return <Fragment key={row.id}>
                <tr className={isExpanded ? "payout-row-expanded" : ""}>
                  <td><button className="payout-period-button" type="button" aria-expanded={isExpanded} onClick={() => setExpandedId(isExpanded ? null : row.id)}>
                    {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <strong>{dateRangeLabel(row.periodBegin, row.periodEnd)}</strong>
                  </button></td>
                  <td className="number payout-amount">{money(row.amount, row.currencyCode)}</td>
                  <td><strong>{dateRangeLabel(analysis.salesWeekBegin, analysis.salesWeekEnd)}</strong><span className="payout-cell-note">Оценка по недельному графику</span></td>
                  <td><span className={`payout-status payout-status-${analysis.status}`}>{reconciliationLabel(analysis.status)}</span><span className="payout-cell-note">{compositionLabel(row)}</span></td>
                </tr>
                {isExpanded && <tr className="payout-detail-row"><td colSpan={4}><div className="payout-analysis">
                  <div className="payout-analysis-head">
                    <div><strong>Начисления за неделю {dateRangeLabel(analysis.salesWeekBegin, analysis.salesWeekEnd)}</strong><span>{analysis.totalRows} строк финансовых операций</span></div>
                    {analysis.status === "matched"
                      ? <p className="payout-analysis-message is-matched">Сумма операций за эту неделю равна переводу. Это совпадение по сумме, а не отдельная связь платежа с заказами.</p>
                      : analysis.status === "different"
                        ? <p className="payout-analysis-message is-different">Сумма операций за эту неделю отличается от перевода на {signedMoney(analysis.difference, row.currencyCode)}. Автоматически считать эту привязку точной нельзя.</p>
                        : <p className="payout-analysis-message is-different">За предполагаемую неделю в сервисе нет финансовых строк. По этой выплате пока нельзя понять, текущие это товары или старые.</p>}
                  </div>
                  <div className="payout-manual-scope">
                    <label>Моя отметка по выплате<select value={row.manualScope ?? "auto"} disabled={savingManualId === row.id} onChange={(event) => saveManualScope(row, event.target.value === "auto" ? null : event.target.value as Exclude<PayoutManualScope, null>)}>
                      <option value="auto">Определять по начислениям</option>
                      <option value="current">За текущие товары</option>
                      <option value="old">За старые товары</option>
                      <option value="mixed">Смешанная: текущие и старые</option>
                      <option value="unknown">Не определено</option>
                    </select></label>
                    <small>Отметка влияет только на фильтр выплат, сумму перевода не меняет.</small>
                    {manualError?.id === row.id && <span className="payout-manual-error">{manualError.message}</span>}
                  </div>
                  <div className="payout-analysis-grid">
                    <div className="payout-analysis-line"><span>Товары текущего каталога</span><strong>{signedMoney(analysis.currentCatalogAmount, row.currencyCode)}</strong><small>{analysis.currentCatalogRows} строк</small></div>
                    <div className="payout-analysis-line"><span>SKU вне каталога</span><strong>{signedMoney(analysis.outsideCatalogAmount, row.currencyCode)}</strong><small>{analysis.outsideCatalogRows} строк</small></div>
                    <div className="payout-analysis-line"><span>Без привязки к товару</span><strong>{signedMoney(analysis.unlinkedAmount, row.currencyCode)}</strong><small>{analysis.unlinkedRows} строк</small></div>
                    <div className="payout-analysis-line is-total"><span>Сумма операций / перевод</span><strong>{money(analysis.accrualAmount, row.currencyCode)} / {money(row.amount, row.currencyCode)}</strong><small>Разница: {signedMoney(analysis.difference, row.currencyCode)}</small></div>
                  </div>
                  {analysis.mixedRows > 0 && <p className="payout-analysis-mixture">{analysis.mixedRows} операций связаны и с товарами каталога, и с SKU вне него. Вся сумма этих операций оставлена в текущих товарах каталога: {signedMoney(analysis.mixedCatalogAmount, row.currencyCode)}.</p>}
                  {analysis.productBreakdown.length > 0 && <div className="payout-analysis-list"><strong>Товары каталога в начислениях</strong>
                    {analysis.productBreakdown.map((product) => <div key={`${product.article}-${product.title}`}><span>{product.title} · арт. {product.article}</span><span>{signedMoney(product.amount, row.currencyCode)} · {product.rows} строк</span></div>)}
                  </div>}
                  {analysis.outsideIdentifiers.length > 0 && <div className="payout-analysis-list"><strong>Найденные SKU и артикулы вне каталога</strong><p>{analysis.outsideIdentifiers.join(", ")}</p></div>}
                  {analysis.currentProductTitles.length > 0 && analysis.productBreakdown.length === 0 && <div className="payout-analysis-list"><strong>Товары каталога в начислениях</strong><p>{analysis.currentProductTitles.join("; ")}</p></div>}
                </div></td></tr>}
              </Fragment>;
            }) : <TableEmptyRow colSpan={4} message="За выбранный период переводов нет." />}</tbody>
      </table>
    </div>
    <TablePagination page={pageRows.page} pageSize={TABLE_PAGE_SIZE} total={visibleRows.length} label="Переводы Ozon" busy={loading} onPageChange={setPage} />
  </section>;
}
