"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, CircleDollarSign, Clock3, RefreshCw, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import { asRecord, displayValue, findRows, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { UnmatchedItems } from "./unmatched-items";

type Overview = JsonRecord & { products?: unknown; recentOrders?: unknown; pendingReturns?: unknown; reconciliationErrors?: unknown; profitReconciliationIssues?: unknown };

function numeric(value: unknown): number { const result = Number(value ?? 0); return Number.isFinite(result) ? result : 0; }
function metric(value: unknown) { return value === null || value === undefined ? "Не рассчитано" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(numeric(value)) + " ₽"; }
function signedMetric(value: unknown) {
  const amount = numeric(value);
  const prefix = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${prefix}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.abs(amount))} ₽`;
}

function BreakdownCard({ title, description, breakdown, labels }: {
  title: string;
  description: string;
  breakdown: JsonRecord | null;
  labels: Record<string, string>;
}) {
  if (!breakdown) return null;
  const rows = Object.entries(labels).flatMap(([key, label]) => {
    const value = breakdown[key];
    return value === undefined || value === null ? [] : [{ key, label, value }];
  });
  const total = breakdown.total;
  if (!rows.length && total === undefined) return null;
  return <section className="panel">
    <div className="panel-head"><div><h2>{title}</h2><span className="small-note">{description}</span></div></div>
    <div className="panel-body mini-stat-list">
      {rows.map(({ key, label, value }) => {
        const amount = numeric(value);
        return <div className="mini-stat" key={key}><span className="mini-stat-label">{label}</span><span className="mini-stat-value number" style={{ color: amount < 0 ? "var(--red)" : amount > 0 ? "var(--green-dark)" : "var(--muted)" }}>{signedMetric(value)}</span></div>;
      })}
      {total !== undefined && <div className="mini-stat" style={{ marginTop: 3, paddingTop: 14, borderTop: "1px solid var(--line)", borderBottom: 0 }}><span className="mini-stat-label" style={{ color: "var(--ink)", fontWeight: 800 }}>Итого</span><span className="mini-stat-value number" style={{ color: numeric(total) < 0 ? "var(--red)" : "var(--ink)", fontSize: 15 }}>{metric(total)}</span></div>}
      <p className="form-help" style={{ marginBottom: 0 }}>Знак показывает влияние суммы на итог: плюс увеличивает, минус уменьшает.</p>
    </div>
  </section>;
}

export function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = asRecord(await requestJson("/api/dashboard"));
      setOverview((asRecord(result?.data) ?? result) as Overview | null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить обзор"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function sync() {
    setSyncing(true); setSyncMessage(""); setSyncError("");
    try { await requestJson("/api/sync", { method: "POST", body: JSON.stringify({ kind: "full" }) }); setSyncMessage("Обновление Ozon запущено. Данные появятся после завершения синхронизации."); }
    catch (reason) { setSyncError(reason instanceof Error ? reason.message : "Не удалось запустить обновление"); }
    finally { setSyncing(false); }
  }

  const products = findRows(overview?.products);
  const recentOrders = findRows(overview?.recentOrders ?? overview?.recentPostings ?? overview?.postingRows);
  const returnRows = findRows(overview?.returnRows ?? overview?.pendingReturns);
  const pendingReturns = returnRows.filter((row) => row.destination === "unknown" || (row.destination === "seller" && !row.receivedBySellerAt) || (row.destination === "ozon" && !row.availableAtOzon));
  const stockSeller = overview?.sellerStockValue ?? overview?.sellerStock ?? overview?.myStockValue;
  const stockOzon = overview?.ozonStockValue ?? overview?.ozonStock;
  const sellerQuantity = stockSeller === undefined ? products.reduce((total, product) => total + numeric(product.sellerStock), 0) : numeric(stockSeller);
  const ozonQuantity = stockOzon === undefined ? products.reduce((total, product) => total + numeric(product.ozonStock), 0) : numeric(stockOzon);
  const preliminary = asRecord(overview?.preliminaryOrders) ?? {};
  const cashBreakdown = asRecord(overview?.cashBreakdown);
  const profitBreakdown = asRecord(overview?.profitBreakdown);
  const warnings = Array.isArray(overview?.reconciliationErrors) ? overview!.reconciliationErrors as unknown[] : [];
  const costingIssues = Array.isArray(overview?.costingIssues) ? overview!.costingIssues as JsonRecord[] : [];
  const profitReconciliationIssues = Array.isArray(overview?.profitReconciliationIssues) ? overview!.profitReconciliationIssues as JsonRecord[] : [];
  const unrecognizedFinanceAmount = numeric(overview?.unrecognizedFinanceAmount);

  return <>
    <PageHeader eyebrow="Панель управления" title="Обзор магазина" description="Коротко о деньгах, остатках и текущих операциях в вашем магазине." actions={<div className="toolbar"><button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} />Обновить</button><button className="button" onClick={() => void sync()} disabled={syncing}><RefreshCw size={14} className={syncing ? "spin" : ""} />{syncing ? "Запускаем…" : "Обновить из Ozon"}</button></div>} />
    {(error || syncError) && <div className="error-banner" role="alert"><AlertTriangle size={15} />{error || syncError}</div>}
    {syncMessage && <div className="success-banner" role="status">{syncMessage}</div>}

    {loading && !overview ? <div className="metrics-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="panel metric-card"><div className="loading-line" style={{ width: "65%" }} /><div style={{ height: 19 }} /><div className="loading-line" style={{ width: "45%", height: 22 }} /></div>)}</div> : error && !overview ? <div className="panel empty-state"><div><div className="empty-icon"><AlertTriangle size={19} /></div><div className="empty-title">Обзор пока недоступен</div><p className="empty-description">Обновите страницу после запуска базы данных или повторите загрузку.</p><button className="button secondary" style={{ marginTop: 12 }} onClick={() => void refresh()}>Повторить</button></div></div> : <>
      <div className="metrics-grid">
        <div className="panel metric-card" style={{ "--metric-bg": "#e8f6ee" } as React.CSSProperties}><Wallet className="metric-icon" size={18} /><div className="metric-label">Расчётный денежный баланс</div><div className="metric-value">{metric(overview?.cashBalance)}</div><div className="metric-help">Покупки, расходы и признанные операции Ozon</div></div>
        <div className="panel metric-card" style={{ "--metric-bg": "#ecf7f2" } as React.CSSProperties}><TrendingUp className="metric-icon" size={18} /><div className="metric-label">Фактическая прибыль</div><div className="metric-value">{metric(overview?.confirmedProfit)}</div><div className="metric-help">{profitReconciliationIssues.length ? `${profitReconciliationIssues.length} возвратов требуют сверки` : overview?.confirmedProfit === null ? "Не хватает себестоимости по части товаров" : "По завершённым и признанным операциям"}</div></div>
        <div className="panel metric-card" style={{ "--metric-bg": "#eef5fa" } as React.CSSProperties}><Boxes className="metric-icon" size={18} /><div className="metric-label">Остаток у меня</div><div className="metric-value">{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(sellerQuantity)} шт.</div><div className="metric-help">Только принятые закупки и полученные возвраты</div></div>
        <div className="panel metric-card" style={{ "--metric-bg": "#fff5e5" } as React.CSSProperties}><ShoppingBag className="metric-icon" size={18} /><div className="metric-label">Предварительные доставки</div><div className="metric-value">{displayValue(preliminary.count ?? overview?.preliminaryOrderCount ?? 0)}</div><div className="metric-help">Заказы младше 21 дня · ожидают признания</div></div>
      </div>

      {(cashBreakdown || profitBreakdown) && <div className="dashboard-grid" style={{ marginBottom: 16 }}>
        <BreakdownCard title="Из чего складывается баланс" description="Компенсации выделены из начислений Ozon и не прибавляются повторно" breakdown={cashBreakdown} labels={{
          recognizedOzonOther: "Прочие признанные начисления Ozon",
          ozonWriteoffCompensation: "Компенсации Ozon",
          purchases: "Закупки",
          expenses: "Общие расходы",
          supplyShipping: "Доставка поставок",
        }} />
        <BreakdownCard title="Из чего складывается прибыль" description="Компенсации выделены из начислений Ozon и не прибавляются повторно" breakdown={profitBreakdown} labels={{
          recognizedOzonOther: "Прочие начисления Ozon",
          ozonWriteoffCompensation: "Компенсации Ozon",
          soldPurchaseCost: "Закупочная себестоимость продаж",
          soldSharedCosts: "Доля общих расходов в продажах",
          manualLossPurchaseCost: "Закупочная стоимость ручных списаний",
          manualLossSharedCosts: "Доля общих расходов в ручных списаниях",
          ozonWriteoffPurchaseCost: "Закупочная себестоимость списаний Ozon",
          ozonWriteoffSharedCosts: "Доля общих расходов в списаниях Ozon",
        }} />
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
            {recentOrders.length ? <div className="table-wrap"><table><thead><tr><th>Отправление</th><th>Дата</th><th>Статус</th><th>Сумма</th></tr></thead><tbody>{recentOrders.slice(0, 5).map((order, index) => <tr key={String(order.id ?? order.orderNumber ?? index)}><td className="table-primary">{String(order.orderNumber ?? order.postingNumber ?? order.id ?? "Заказ")}</td><td>{displayValue(order.deliveredAt ?? order.orderDate, "date")}</td><td><span className="badge">{displayValue(order.status, "status")}</span></td><td className="number">{displayValue(order.amount ?? order.accrualAmount, "money")}</td></tr>)}</tbody></table></div> : <div className="empty-state" style={{ minHeight: 135 }}><div><div className="empty-icon"><ShoppingBag size={19} /></div><div className="empty-title">Заказы появятся здесь</div><p className="empty-description">Запустите обновление из Ozon в настройках.</p></div></div>}
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
              {unrecognizedFinanceAmount !== 0 && <div className="notice"><AlertTriangle size={15} /><span>{metric(Math.abs(unrecognizedFinanceAmount))} начислений Ozon не включены в итог и требуют проверки сопоставления.</span></div>}
              {profitReconciliationIssues.length > 0 && <div className="notice"><AlertTriangle size={15} /><span>{profitReconciliationIssues.length} возвратов меняют остаток или требуют проверки количества; прибыль по ним требует сверки.</span></div>}
              {pendingReturns.length > 0 && <div className="notice"><Clock3 size={15} /><span>{pendingReturns.length} возвратов ожидают обработки или подтверждения получения.</span></div>}
              {warnings.length === 0 && pendingReturns.length === 0 && costingIssues.length === 0 && profitReconciliationIssues.length === 0 && unrecognizedFinanceAmount === 0 && <div className="empty-state" style={{ minHeight: 92, padding: 4 }}><div><div className="empty-title">Сейчас всё спокойно</div><p className="empty-description">Здесь появятся расхождения остатков и возвраты, требующие вашего действия.</p></div></div>}
              {warnings.length > 0 && <Link href="/catalog" className="button secondary small">Проверить каталог</Link>}
              {costingIssues.length > 0 && <Link href="/purchases" className="button secondary small">Проверить приёмки</Link>}
              {pendingReturns.length > 0 && <Link href="/returns" className="button secondary small">Открыть возвраты</Link>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Быстрый переход</h2><CircleDollarSign size={17} color="#178b63" /></div>
            <div className="panel-body mini-stat-list">
              <Link href="/purchases" className="mini-stat"><span className="mini-stat-label"><span className="mini-dot" />Внести закупку</span><span className="small-note">Закупки →</span></Link>
              <Link href="/supplies" className="mini-stat"><span className="mini-stat-label"><span className="mini-dot blue" />Создать поставку</span><span className="small-note">Поставки →</span></Link>
              <Link href="/expenses" className="mini-stat"><span className="mini-stat-label"><span className="mini-dot orange" />Добавить расход</span><span className="small-note">Расходы →</span></Link>
            </div>
          </section>
        </div>
      </div>
      <UnmatchedItems />
    </>}
  </>;
}
