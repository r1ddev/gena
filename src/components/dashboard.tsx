"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Clock3, CreditCard, Info, ShoppingBag } from "lucide-react";
import { asRecord, displayValue, findRows, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { UnmatchedItems } from "./unmatched-items";
import { OzonOrderLink } from "./ozon-order-link";
import { returnsNeedingAction, unmatchedItemsNotice } from "./dashboard-summary";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";
import { cycleTableSort, filterAndSortRows, paginateRows, TableEmptyRow, TableHead, TablePagination, TABLE_PAGE_SIZE, type TableColumn, type TableSort } from "./table-controls";
import { DashboardTrends, type DailyTrendDay } from "./dashboard-trends";

type Overview = JsonRecord & { products?: unknown; recentOrders?: unknown; pendingReturns?: unknown; reconciliationErrors?: unknown; profitReconciliationIssues?: unknown };

const dashboardOrderColumns: TableColumn<JsonRecord>[] = [
  { key: "orderNumber", label: "Отправление", kind: "identifier", value: (row) => row.orderNumber ?? row.postingNumber ?? row.externalId ?? row.id },
  { key: "orderDate", label: "Дата", kind: "date", value: (row) => row.deliveredAt ?? row.orderDate },
  { key: "status", label: "Статус", kind: "status" },
  { key: "amount", label: "Сумма", kind: "money", value: (row) => row.amount ?? row.accrualAmount },
];

function numeric(value: unknown): number { const result = Number(value ?? 0); return Number.isFinite(result) ? result : 0; }
function metric(value: unknown) { return value === null || value === undefined ? "Не рассчитано" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(numeric(value)) + " ₽"; }
function signedMetric(value: unknown) {
  const amount = numeric(value);
  const prefix = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${prefix}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.abs(amount))} ₽`;
}

function BreakdownCard({ title, tooltipId, explanation, breakdown, labels, detailLabels, note, showTotal = true }: {
  title: string;
  tooltipId: string;
  explanation: string;
  breakdown: JsonRecord | null;
  labels: Record<string, string>;
  detailLabels?: Record<string, string>;
  note?: string;
  showTotal?: boolean;
}) {
  if (!breakdown) return null;
  const rows = Object.entries(labels).flatMap(([key, label]) => {
    const value = breakdown[key];
    return value === undefined || value === null ? [] : [{ key, label, value }];
  });
  const detailRows = Object.entries(detailLabels ?? {}).flatMap(([key, label]) => {
    const value = breakdown[key];
    return value === undefined || value === null ? [] : [{ key, label, value }];
  });
  const total = breakdown.total;
  if (!rows.length && !detailRows.length && total === undefined) return null;
  return <section className="panel">
    <div className="panel-head"><div className="breakdown-heading"><h2>{title}</h2><span className="breakdown-info">
      <button className="breakdown-info-button" type="button" aria-label={`Как рассчитывается: ${title}`} aria-describedby={tooltipId}><Info size={14} aria-hidden="true" /></button>
      <span className="breakdown-tooltip" role="tooltip" id={tooltipId}>{explanation}</span>
    </span></div></div>
    <div className="panel-body mini-stat-list">
      {rows.map(({ key, label, value }) => {
        const amount = numeric(value);
        const formatted = key === "sharedExpenseCoefficient"
          ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount * 100)}%`
          : signedMetric(value);
        return <div className="mini-stat" key={key}><span className="mini-stat-label">{label}</span><span className="mini-stat-value number" style={{ color: amount < 0 ? "var(--red)" : amount > 0 ? "var(--green-dark)" : "var(--muted)" }}>{formatted}</span></div>;
      })}
      {detailRows.length > 0 && <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <div className="small-note" style={{ marginBottom: 5 }}>Денежная часть надбавки уже учтена в прибыли по заказам; сами затраты используются для расчёта процента</div>
        {detailRows.map(({ key, label, value }) => {
          const amount = numeric(value);
          const formatted = key === "sharedExpenseCoefficient"
            ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount * 100)}%`
            : signedMetric(value);
          const nested = key === "soldMySharedCosts" || key === "soldOzonSharedCosts";
          return <div className="mini-stat" key={key} style={nested ? { paddingLeft: 14 } : undefined}><span className="mini-stat-label">{label}</span><span className="mini-stat-value number" style={{ color: amount < 0 ? "var(--red)" : amount > 0 ? "var(--green-dark)" : "var(--muted)" }}>{formatted}</span></div>;
        })}
      </div>}
      {note && <p className="small-note" style={{ marginTop: 10, marginBottom: 0 }}>{note}</p>}
      {showTotal && total !== undefined && <div className="mini-stat" style={{ marginTop: 3, paddingTop: 14, borderTop: "1px solid var(--line)", borderBottom: 0 }}><span className="mini-stat-label" style={{ color: "var(--ink)", fontWeight: 800 }}>Итого</span><span className="mini-stat-value number" style={{ color: numeric(total) < 0 ? "var(--red)" : "var(--ink)", fontSize: 15 }}>{metric(total)}</span></div>}
    </div>
  </section>;
}

function CashFlowCard({ cashFlow }: { cashFlow: JsonRecord | null }) {
  if (!cashFlow) return null;
  return <section className="panel">
    <div className="panel-head"><div className="breakdown-heading"><h2>Поступления и расходы</h2><span className="breakdown-info">
      <button className="breakdown-info-button" type="button" aria-label="Как рассчитываются денежные движения" aria-describedby="breakdown-cashflow"><Info size={14} aria-hidden="true" /></button>
      <span className="breakdown-tooltip" role="tooltip" id="breakdown-cashflow">Сумма всех поступлений минус сумма всех расходов: учтены операции Ozon, закупки и ваши расходы. Выплаты Ozon показаны отдельно.</span>
    </span></div></div>
    <div className="panel-body mini-stat-list">
      <div style={{ marginBottom: 6 }}>
        <div className="mini-stat" style={{ borderBottom: 0, paddingBottom: 4 }}>
          <span className="mini-stat-label" style={{ color: "var(--ink)", fontWeight: 800 }}><ArrowUpRight size={14} color="#178b63" />Поступления</span>
          <span className="mini-stat-value number" style={{ color: "var(--green-dark)" }}>{metric(cashFlow.totalIncome)}</span>
        </div>
      </div>
      <div style={{ marginTop: 5, paddingTop: 9, borderTop: "1px solid var(--line)" }}>
        <div className="mini-stat" style={{ borderBottom: 0, paddingBottom: 4 }}>
          <span className="mini-stat-label" style={{ color: "var(--ink)", fontWeight: 800 }}><ArrowDownRight size={14} color="#c84d4d" />Расходы</span>
          <span className="mini-stat-value number" style={{ color: "var(--red)" }}>−{metric(cashFlow.totalExpenses)}</span>
        </div>
      </div>
      <div className="mini-stat" style={{ marginTop: 3, paddingTop: 14, borderTop: "1px solid var(--line)", borderBottom: 0 }}>
        <span className="mini-stat-label" style={{ color: "var(--ink)", fontWeight: 800 }}>Поступления минус расходы</span>
        <span className="mini-stat-value number" style={{ color: numeric(cashFlow.total) < 0 ? "var(--red)" : "var(--ink)", fontSize: 15 }}>{signedMetric(cashFlow.total)}</span>
      </div>
    </div>
  </section>;
}

function currencyAmount(value: unknown, currencyCode: string) {
  if (currencyCode === "RUB") return metric(value);
  const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(numeric(value));
  return /^[A-Z]{3}$/.test(currencyCode) ? `${amount} ${currencyCode}` : `${amount} ${currencyCode || "валюта"}`;
}

function ActualCashCard({ actualCash }: { actualCash: JsonRecord | null }) {
  if (!actualCash) return null;
  const payouts = findRows(actualCash.payouts);
  const unsupportedCurrencies = Array.isArray(actualCash.unsupportedCurrencies) ? actualCash.unsupportedCurrencies.map(String) : [];
  const loaded = actualCash.loaded === true;
  const total = actualCash.total;
  return <section className="panel">
    <div className="panel-head"><div className="breakdown-heading"><h2>Реальные деньги</h2><span className="breakdown-info">
      <button className="breakdown-info-button" type="button" aria-label="Как рассчитываются реальные деньги" aria-describedby="breakdown-actual-cash"><Info size={14} aria-hidden="true" /></button>
      <span className="breakdown-tooltip" role="tooltip" id="breakdown-actual-cash">Выплаты Ozon минус уже оплаченные закупки и добавленные вами расходы. Зачисление денег проверьте по выписке банка.</span>
    </span></div><CreditCard size={17} color="#178b63" /></div>
    <div className="panel-body mini-stat-list">
      <div className="mini-stat" style={{ borderBottom: 0, paddingBottom: 4 }}>
        <span className="mini-stat-label" style={{ color: "var(--ink)", fontWeight: 800 }}><ArrowUpRight size={14} color="#178b63" />Выплаты Ozon</span>
        <span className="mini-stat-value number" style={{ color: "var(--green-dark)" }}>{payouts.length ? payouts.map((row) => `+${currencyAmount(row.amount, String(row.currencyCode ?? "RUB"))}`).join(" · ") : metric(0)}</span>
      </div>
      {payouts.length > 0 && <div className="small-note" style={{ paddingLeft: 20, marginTop: -3, marginBottom: 6 }}>{displayValue(actualCash.periods)} периода выплат</div>}
      <div className="mini-stat">
        <span className="mini-stat-label"><ArrowDownRight size={14} color="#c84d4d" />Закупки</span>
        <span className="mini-stat-value number" style={{ color: "var(--red)" }}>−{metric(actualCash.purchases)}</span>
      </div>
      <div className="mini-stat">
        <span className="mini-stat-label"><ArrowDownRight size={14} color="#c84d4d" />Мои расходы</span>
        <span className="mini-stat-value number" style={{ color: "var(--red)" }}>−{metric(actualCash.expenses)}</span>
      </div>
      <div className="mini-stat" style={{ marginTop: 3, paddingTop: 14, borderTop: "1px solid var(--line)", borderBottom: 0 }}>
        <span className="mini-stat-label" style={{ color: "var(--ink)", fontWeight: 800 }}>Итого</span>
        <span className="mini-stat-value number" style={{ color: total !== null && numeric(total) < 0 ? "var(--red)" : "var(--ink)", fontSize: 15 }}>{total === null || total === undefined ? "Не рассчитано" : signedMetric(total)}</span>
      </div>
      {!loaded && <div className="small-note" style={{ marginTop: 8 }}>Выплаты ещё не загружены. Нажмите «Синхронизировать», чтобы получить их из Ozon.</div>}
      {unsupportedCurrencies.length > 0 && <div className="small-note" style={{ marginTop: 8 }}>В отчёте есть валюта {unsupportedCurrencies.join(", ")}; для итога вместе с рублёвыми расходами нужен курс пересчёта.</div>}
    </div>
  </section>;
}

export function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recentOrderFilters, setRecentOrderFilters] = useState<Record<string, string>>({});
  const [recentOrderSort, setRecentOrderSort] = useState<TableSort>(null);
  const [recentOrderPage, setRecentOrderPage] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = asRecord(await requestJson("/api/dashboard"));
      setOverview((asRecord(result?.data) ?? result) as Overview | null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить обзор"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const refreshAfterSync = () => { void refresh(); };
    window.addEventListener("popstate", refreshAfterSync);
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    return () => {
      window.removeEventListener("popstate", refreshAfterSync);
      window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    };
  }, [refresh]);

  const products = findRows(overview?.products);
  const recentOrders = findRows(overview?.recentPostings ?? overview?.postingRows ?? overview?.recentOrders);
  const visibleRecentOrders = useMemo(() => filterAndSortRows(recentOrders, dashboardOrderColumns, recentOrderFilters, recentOrderSort), [recentOrders, recentOrderFilters, recentOrderSort]);
  const recentOrderPagination = useMemo(() => paginateRows(visibleRecentOrders, recentOrderPage), [visibleRecentOrders, recentOrderPage]);
  const returnRows = findRows(overview?.returnRows ?? overview?.pendingReturns);
  const pendingReturns = returnsNeedingAction(returnRows);
  const stockSeller = overview?.sellerStockValue ?? overview?.sellerStock ?? overview?.myStockValue;
  const stockOzon = overview?.ozonStockValue ?? overview?.ozonStock;
  const sellerQuantity = stockSeller === undefined ? products.reduce((total, product) => total + numeric(product.sellerStock), 0) : numeric(stockSeller);
  const ozonQuantity = stockOzon === undefined ? products.reduce((total, product) => total + numeric(product.ozonStock), 0) : numeric(stockOzon);
  const preliminary = asRecord(overview?.preliminaryOrders) ?? {};
  const cashFlow = asRecord(overview?.cashFlow);
  const actualCash = asRecord(overview?.actualCash);
  const profitBreakdown = asRecord(overview?.profitBreakdown);
  const trend = asRecord(overview?.dailyTrend);
  const trendDays = findRows(trend?.days).flatMap((day): DailyTrendDay[] => {
    const date = String(day.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    return [{
      date,
      orders: numeric(day.orders),
      deliveredOrders: numeric(day.deliveredOrders),
      profitCents: numeric(day.profitCents),
      incompleteProfitCount: numeric(day.incompleteProfitCount),
    }];
  });
  const warnings = Array.isArray(overview?.reconciliationErrors) ? overview!.reconciliationErrors as unknown[] : [];
  const costingIssues = Array.isArray(overview?.costingIssues) ? overview!.costingIssues as JsonRecord[] : [];
  const profitReconciliationIssues = Array.isArray(overview?.profitReconciliationIssues) ? overview!.profitReconciliationIssues as JsonRecord[] : [];
  const unrecognizedFinanceAmount = numeric(overview?.unrecognizedFinanceAmount);
  const unresolvedExternalItems = findRows(overview?.unresolvedExternalItems);
  const unmatchedNotice = unmatchedItemsNotice(unresolvedExternalItems.length, unrecognizedFinanceAmount);

  function updateRecentOrderSort(key: string) {
    setRecentOrderSort((current) => cycleTableSort(current, key));
    setRecentOrderPage(1);
  }

  return <>
    <PageHeader eyebrow="Панель управления" title="Обзор магазина" description="Остатки, продажи, прибыль и последние заказы." />
    {error && <div className="error-banner" role="alert"><AlertTriangle size={15} />{error}</div>}
    {unmatchedNotice && <section className="notice" style={{ marginBottom: 16 }} aria-live="polite">
      <AlertTriangle size={16} />
      <span><strong>{unmatchedNotice.count} записей Ozon без связи с каталогом.</strong> Уже загруженные по ним денежные движения показаны справа; прибыль по товарам пересчитается после сопоставления.</span>
      <Link href={unmatchedNotice.href} className="button secondary small">Открыть список</Link>
    </section>}

    {loading && !overview ? <div className="metrics-grid dashboard-metrics-grid">{[1, 2].map((item) => <div key={item} className="panel metric-card"><div className="loading-line" style={{ width: "65%" }} /><div style={{ height: 19 }} /><div className="loading-line" style={{ width: "45%", height: 22 }} /></div>)}</div> : error && !overview ? <div className="panel empty-state"><div><div className="empty-icon"><AlertTriangle size={19} /></div><div className="empty-title">Обзор пока недоступен</div><p className="empty-description">Попробуйте загрузить данные ещё раз через несколько секунд.</p><button className="button secondary" style={{ marginTop: 12 }} onClick={() => void refresh()}>Повторить</button></div></div> : <>
      <div className="metrics-grid dashboard-metrics-grid">
        <div className="panel metric-card" style={{ "--metric-bg": "#eef5fa" } as React.CSSProperties}><Boxes className="metric-icon" size={18} /><div className="metric-label">Остаток у меня</div><div className="metric-value">{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(sellerQuantity)} шт.</div><div className="metric-help">Только принятые закупки и полученные возвраты</div></div>
        <div className="panel metric-card" style={{ "--metric-bg": "#fff5e5" } as React.CSSProperties}><ShoppingBag className="metric-icon" size={18} /><div className="metric-label">Предварительные доставки</div><div className="metric-value">{displayValue(preliminary.count ?? overview?.preliminaryOrderCount ?? 0)}</div><div className="metric-help">Заказы младше 21 дня · ожидают признания</div></div>
      </div>

      {trendDays.length > 0 && <DashboardTrends days={trendDays} incompleteProfitCount={numeric(trend?.incompleteProfitCount)} />}

      {(cashFlow || profitBreakdown || actualCash) && <div className="dashboard-grid dashboard-finance-grid" style={{ marginBottom: 16 }}>
        {profitBreakdown && <BreakdownCard title="Прибыль по товарам" tooltipId="breakdown-profit" explanation="Для доставленного отправления берётся итог Ozon и вычитается полная себестоимость товаров, оставшихся у покупателя. В себестоимость входят закупка и добавочная стоимость. При возврате себестоимость возвращённого товара не вычитается. Отменённое отправление учитывается по итогу Ozon без себестоимости." breakdown={profitBreakdown} note={numeric(profitBreakdown.orderProfitIncompleteCount) > 0 ? `Не рассчитана прибыль по ${numeric(profitBreakdown.orderProfitIncompleteCount)} отправлениям: не хватает связи с товаром или его себестоимости.` : undefined} labels={{
          orderProfit: "Прибыль после себестоимости",
          sharedExpenseCoefficient: "Добавочная стоимость, %",
        }} showTotal={false} />}
        {cashFlow && <CashFlowCard cashFlow={cashFlow} />}
        {actualCash && <ActualCashCard actualCash={actualCash} />}
      </div>}

      <div className="dashboard-grid">
        <div className="dashboard-column">
          <section className="panel">
            <div className="panel-head"><div><h2>Остатки по местам хранения</h2><span className="small-note">На основе истории складских операций</span></div><Link href="/catalog" className="button secondary small">Каталог</Link></div>
            <div className="panel-body mini-stat-list">
              <div className="mini-stat"><span className="mini-stat-label"><span className="mini-dot" />Мой склад</span><span className="mini-stat-value">{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(sellerQuantity)} шт.</span></div>
              <div className="mini-stat"><span className="mini-stat-label"><span className="mini-dot blue" />Склад Ozon</span><span className="mini-stat-value">{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(ozonQuantity)} шт.</span></div>
              <div className="mini-stat"><span className="mini-stat-label"><span className="mini-dot orange" />Товаров в каталоге</span><span className="mini-stat-value">{displayValue(overview?.productCount ?? products.length)}</span></div>
              <div className="mini-stat"><span className="mini-stat-label"><span className="mini-dot red" />Нужно разобраться</span><span className="mini-stat-value">{warnings.length + pendingReturns.length}</span></div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><div><h2>Последние заказы</h2><span className="small-note">Предварительные и признанные</span></div><Link href="/sales" className="button secondary small">Все заказы</Link></div>
            {recentOrders.length ? <><div className="table-wrap"><table><TableHead columns={dashboardOrderColumns} rows={recentOrders} filters={recentOrderFilters} onFilter={(key, value) => { setRecentOrderFilters((current) => ({ ...current, [key]: value })); setRecentOrderPage(1); }} sort={recentOrderSort} onSort={updateRecentOrderSort} /><tbody>{visibleRecentOrders.length ? recentOrderPagination.rows.map((order, index) => {
              const postingNumber = String(order.orderNumber ?? order.postingNumber ?? order.externalId ?? "");
              const orderLabel = postingNumber || String(order.id ?? "Заказ");
              return <tr key={String(order.id ?? postingNumber ?? index)}><td className="table-primary">{postingNumber ? <OzonOrderLink postingNumber={postingNumber} /> : orderLabel}</td><td>{displayValue(order.deliveredAt ?? order.orderDate, "date")}</td><td><span className="badge">{displayValue(order.status, "status")}</span>{typeof order.returnState === "string" && <span className="table-secondary">{order.returnState}</span>}</td><td className="number">{displayValue(order.amount ?? order.accrualAmount, "money")}</td></tr>;
            }) : <TableEmptyRow colSpan={dashboardOrderColumns.length} message="По заданным условиям совпадений нет." onClear={() => { setRecentOrderFilters({}); setRecentOrderPage(1); }} />}</tbody></table></div><TablePagination page={recentOrderPagination.page} pageSize={TABLE_PAGE_SIZE} total={visibleRecentOrders.length} label="Заказы на главной" busy={loading} onPageChange={setRecentOrderPage} /></> : <div className="empty-state" style={{ minHeight: 135 }}><div><div className="empty-icon"><ShoppingBag size={19} /></div><div className="empty-title">Заказов пока нет</div><p className="empty-description">Обновите продажи на странице «Продажи», чтобы загрузить заказы.</p><Link href="/sales" className="button secondary small" style={{ marginTop: 12 }}>Открыть продажи</Link></div></div>}
          </section>
        </div>

        <div className="dashboard-column">
          <section className="panel">
            <div className="panel-head"><div><h2>Предварительные продажи</h2><span className="small-note">За последние 21 день</span></div><Clock3 size={17} color="#b67a15" /></div>
            <div className="panel-body mini-stat-list"><div className="mini-stat"><span className="mini-stat-label"><ArrowUpRight size={14} color="#178b63" />Сумма продаж</span><span className="mini-stat-value">{metric(preliminary.grossAmount ?? overview?.preliminaryGrossAmount)}</span></div><div className="mini-stat"><span className="mini-stat-label"><ArrowDownRight size={14} color="#b67a15" />Ожидаемая прибыль</span><span className="mini-stat-value">{metric(preliminary.expectedProfit ?? overview?.preliminaryExpectedProfit)}</span></div></div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Проверить</h2><AlertTriangle size={16} color="#b67a15" /></div>
            <div className="panel-body notice-list">
              {warnings.length > 0 && <div className="notice critical"><AlertTriangle size={15} /><span>Есть {warnings.length} отрицательных остатка. Проверьте поставки и складские движения.</span></div>}
              {costingIssues.length > 0 && <div className="notice critical"><AlertTriangle size={15} /><span>Прибыль не рассчитана: нет полученной закупочной себестоимости у {costingIssues.length} товаров. Проверьте приёмки.</span></div>}
              {profitReconciliationIssues.length > 0 && <div className="notice"><AlertTriangle size={15} /><span>{profitReconciliationIssues.length} возвратов меняют остаток или требуют проверки количества; прибыль по ним требует сверки.</span></div>}
              {pendingReturns.length > 0 && <div className="notice"><Clock3 size={15} /><span>{pendingReturns.length} возвратов ожидают обработки или подтверждения получения.</span></div>}
              {warnings.length === 0 && pendingReturns.length === 0 && costingIssues.length === 0 && profitReconciliationIssues.length === 0 && <div className="empty-state" style={{ minHeight: 92, padding: 4 }}><div><div className="empty-title">Сейчас всё спокойно</div><p className="empty-description">Здесь появятся расхождения остатков и возвраты, требующие вашего действия.</p></div></div>}
              {warnings.length > 0 && <Link href="/catalog" className="button secondary small">Проверить каталог</Link>}
              {costingIssues.length > 0 && <Link href="/purchases" className="button secondary small">Проверить приёмки</Link>}
              {pendingReturns.length > 0 && <Link href="/returns" className="button secondary small">Открыть возвраты</Link>}
            </div>
          </section>
        </div>
      </div>
      <UnmatchedItems />
    </>}
  </>;
}
