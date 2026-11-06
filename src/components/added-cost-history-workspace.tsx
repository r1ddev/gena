"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { OzonOrderLink } from "@/components/ozon-order-link";
import { OzonAccrualLink } from "@/components/ozon-accrual-link";
import { TableEmptyRow, TablePagination } from "@/components/table-controls";

type HistoryOperation = {
  id: string;
  kind: "receipt" | "my_expense" | "ozon_expense" | "sale" | "return" | "writeoff";
  title: string;
  details: string;
  occurredAt: string;
  postingNumber?: string;
  orderNumber?: string;
  orderDate?: string | null;
  purchaseDate?: string;
  status?: string;
  sourceNumber?: string;
  sourceNumberIsAccrual?: boolean;
  productSku?: string;
  productTitle?: string;
  quantity?: string;
  unitCost?: string;
  note?: string;
  poolBefore: string;
  poolDelta: string;
  poolAfter: string;
  stockValueBefore: string;
  stockValueDelta: string;
  stockValueAfter: string;
  stockQuantityBefore: string;
  stockQuantityDelta: string;
  stockQuantityAfter: string;
  ratePercent?: string;
  purchaseValueSold?: string;
  allocatedSharedCosts?: string;
  explanation?: string;
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

const PAGE_SIZE = 50;
const moneyFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantityFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const percentFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 8 });

function numberValue(value: string | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function money(value: string | undefined) {
  return `${moneyFormatter.format(numberValue(value))} ₽`;
}

function signedMoney(value: string | undefined) {
  const amount = numberValue(value);
  const prefix = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${prefix}${moneyFormatter.format(Math.abs(amount))} ₽`;
}

function signedQuantity(value: string | undefined) {
  const amount = numberValue(value);
  const prefix = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${prefix}${quantityFormatter.format(Math.abs(amount))} шт.`;
}

function percent(value: string | undefined) {
  return `${percentFormatter.format(numberValue(value))}%`;
}

function date(value: string | null | undefined) {
  if (!value) return "Дата не указана";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function deltaClass(value: string) {
  const amount = numberValue(value);
  return amount > 0 ? "added-cost-positive" : amount < 0 ? "added-cost-negative" : "";
}

function OperationEffect({ operation }: { operation: HistoryOperation }) {
  if (operation.kind === "sale") {
    if (operation.ratePercent === undefined) return <div className="added-cost-formula">{operation.explanation || "Процент не рассчитан."}</div>;
    return <div className="added-cost-formula">
      <div>{money(operation.poolBefore)} ÷ {money(operation.stockValueBefore)} × 100 = <strong>{percent(operation.ratePercent)}</strong></div>
      <div>{money(operation.purchaseValueSold)} × {percent(operation.ratePercent)} = <strong>{money(operation.allocatedSharedCosts)}</strong> расходов распределено на отправление</div>
      {operation.explanation && <small>{operation.explanation}</small>}
    </div>;
  }
  if (operation.kind === "receipt") {
    return <div className="added-cost-formula">
      <div>{operation.quantity ? quantityFormatter.format(numberValue(operation.quantity)) : "0"} шт. × {money(operation.unitCost)} = <strong>{signedMoney(operation.stockValueDelta)}</strong> к закупочной стоимости остатков</div>
      <small>В расчёт попала дата приёмки, не дата оформления закупки.</small>
    </div>;
  }
  if (operation.kind === "my_expense" || operation.kind === "ozon_expense") {
    return <div className="added-cost-formula">Изменение нераспределённых расходов: <strong className={deltaClass(operation.poolDelta)}>{signedMoney(operation.poolDelta)}</strong></div>;
  }
  return <div className="added-cost-formula">
    <div>Закупочная стоимость остатков: <strong className={deltaClass(operation.stockValueDelta)}>{signedMoney(operation.stockValueDelta)}</strong></div>
    <div>Нераспределённые расходы: <strong className={deltaClass(operation.poolDelta)}>{signedMoney(operation.poolDelta)}</strong></div>
    {operation.explanation && <small>{operation.explanation}</small>}
  </div>;
}

function BalanceChange({ title, before, delta, after }: { title: string; before: string; delta: string; after: string }) {
  return <div className="added-cost-balance">
    <span>{title}</span>
    <div className="added-cost-balance-values">
      <strong>{money(before)}</strong>
      <span aria-hidden="true">→</span>
      <b className={deltaClass(delta)}>{signedMoney(delta)}</b>
      <span aria-hidden="true">→</span>
      <strong>{money(after)}</strong>
    </div>
  </div>;
}

export function AddedCostHistoryWorkspace() {
  const [rows, setRows] = useState<HistoryOperation[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search.trim()) params.set("q", search.trim());
      try {
        const response = await fetch(`/api/added-cost-history?${params}`, { cache: "no-store", signal: controller.signal });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(typeof result === "object" && result !== null && "message" in result && typeof result.message === "string" ? result.message : "Не удалось загрузить историю.");
        if (typeof result !== "object" || result === null) throw new Error("Сервер вернул неверный ответ.");
        const data = result as { items?: unknown; pagination?: Partial<Pagination> };
        setRows(Array.isArray(data.items) ? data.items as HistoryOperation[] : []);
        if (data.pagination && typeof data.pagination.total === "number") {
          setPagination({
            page: typeof data.pagination.page === "number" ? data.pagination.page : page,
            pageSize: typeof data.pagination.pageSize === "number" ? data.pagination.pageSize : PAGE_SIZE,
            total: data.pagination.total,
            totalPages: typeof data.pagination.totalPages === "number" ? data.pagination.totalPages : 1,
          });
        }
      } catch (reason) {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setRows([]);
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [page, search]);

  return <>
    <section className="panel added-cost-history-note">
      <p>Для заказов показаны дата заказа и дата, когда заказ изменил расчёт. Закупочная стоимость растёт после приёмки. Общие расходы распределяются на товары; возвраты и списания меняют остатки и уже распределённую сумму.</p>
    </section>
    <section className="panel">
      <div className="panel-head added-cost-history-head">
        <div>
          <h2>Операции расчёта</h2>
          <span className="small-note">{loading ? "Загружаем…" : `${pagination.total} операций`}</span>
        </div>
        <label className="search-box" aria-label="Поиск по истории">
          <Search size={14} />
          <input placeholder="Поиск по товару, заказу или расходу" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="added-cost-history-table">
          <thead><tr>{[
            "Дата расчёта / заказа",
            "Операция",
            "Заказ или товар",
            "Нераспределённые расходы: до · изменение · после",
            "Закупочная стоимость остатков: до · изменение · после",
            "Как посчитано",
          ].map((label, index) => <th key={label}>{label}<button type="button" className="table-column-resize-handle" data-table-column-resize-index={index} aria-label={`Изменить ширину столбца «${label}»`} title="Перетащите границу, чтобы изменить ширину" /></th>)}</tr></thead>
          <tbody>
            {error ? <TableEmptyRow colSpan={6} message={error} />
              : loading && rows.length === 0 ? <TableEmptyRow colSpan={6} message="Загружаем историю…" />
                : rows.length === 0 ? <TableEmptyRow colSpan={6} message={search ? "По этому запросу операций нет." : "Операций, влияющих на добавочную стоимость, пока нет."} />
                  : rows.map((operation) => <tr key={operation.id}>
                    <td className="added-cost-date">
                      <strong>{date(operation.occurredAt)}</strong>
                      {operation.kind === "sale" && operation.orderDate && <small>Заказ: {date(operation.orderDate)}</small>}
                      {operation.kind === "receipt" && operation.purchaseDate && <small>Закупка оформлена: {date(operation.purchaseDate)}</small>}
                    </td>
                    <td><strong>{operation.title}</strong></td>
                    <td className="added-cost-detail-cell">
                      {operation.postingNumber && <OzonOrderLink postingNumber={operation.postingNumber}>{operation.postingNumber}</OzonOrderLink>}
                      {operation.orderNumber && operation.postingNumber && <small>Заказ {operation.orderNumber}</small>}
                      {operation.sourceNumber && (operation.sourceNumberIsAccrual
                        ? <OzonAccrualLink accrualNumber={operation.sourceNumber}>{operation.sourceNumber}</OzonAccrualLink>
                        : <span>{operation.sourceNumber}</span>)}
                      <span>{operation.details}</span>
                      {operation.note && <small>{operation.note}</small>}
                    </td>
                    <td><BalanceChange title="Нераспределённые расходы" before={operation.poolBefore} delta={operation.poolDelta} after={operation.poolAfter} /></td>
                    <td><BalanceChange title="Закупочная стоимость" before={operation.stockValueBefore} delta={operation.stockValueDelta} after={operation.stockValueAfter} /><small className="added-cost-stock-count">Остаток: {quantityFormatter.format(numberValue(operation.stockQuantityBefore))} {signedQuantity(operation.stockQuantityDelta)} → {quantityFormatter.format(numberValue(operation.stockQuantityAfter))} шт.</small></td>
                    <td><OperationEffect operation={operation} /></td>
                  </tr>)}
          </tbody>
        </table>
      </div>
      <TablePagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} label="История добавочной стоимости" busy={loading} onPageChange={setPage} />
    </section>
  </>;
}
