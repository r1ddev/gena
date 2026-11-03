"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { asRecord, findRows, requestJson, type JsonRecord } from "@/components/api";
import { OZON_SYNC_COMPLETED_EVENT } from "@/components/ozon-sync-events";
import { TableEmptyRow, TablePagination, TABLE_PAGE_SIZE, paginateRows } from "@/components/table-controls";

type PayoutRow = JsonRecord & {
  id: string;
  periodBegin: string;
  periodEnd: string;
  currencyCode: string;
  amount: string;
};

const moneyFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "short", year: "numeric" });

function money(value: unknown, currencyCode = "RUB") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const suffix = currencyCode === "RUB" ? "₽" : currencyCode;
  return `${amount < 0 ? "−" : ""}${moneyFormatter.format(Math.abs(amount))} ${suffix}`;
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

function filterText(row: PayoutRow) {
  return [row.periodBegin, row.periodEnd, row.amount, row.currencyCode].join(" ").toLocaleLowerCase("ru-RU");
}

export function PayoutsWorkspace() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
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

  return <section className="panel payouts-panel">
    <div className="panel-head payouts-list-head">
      <div><h2>Список переводов</h2><span className="small-note">{loading ? "Загружаем…" : `Переводов: ${visibleRows.length}`}</span></div>
      <label className="search-box" aria-label="Поиск по переводам"><Search size={14} /><input placeholder="Поиск по периоду или сумме" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
    </div>
    <div className="payout-date-filters">
      <label>Период от<input type="date" aria-label="Период от" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label>
      <label>Период до<input type="date" aria-label="Период до" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label>
      {(search || dateFrom || dateTo) && <button className="button secondary" type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setPage(1); }}>Сбросить фильтры</button>}
    </div>
    <div className="table-wrap payouts-table-wrap">
      <table className="payouts-table">
        <thead><tr><th>Период отчёта</th><th>Сумма перевода Ozon</th></tr></thead>
        <tbody>{error ? <TableEmptyRow colSpan={2} message={error} />
          : loading && rows.length === 0 ? <TableEmptyRow colSpan={2} message="Загружаем выплаты…" />
            : pageRows.rows.length ? pageRows.rows.map((row) => <tr key={row.id}>
              <td><strong>{dateRangeLabel(row.periodBegin, row.periodEnd)}</strong></td>
              <td className="number payout-amount">{money(row.amount, row.currencyCode)}</td>
            </tr>) : <TableEmptyRow colSpan={2} message="За выбранный период переводов нет." />}</tbody>
      </table>
    </div>
    <TablePagination page={pageRows.page} pageSize={TABLE_PAGE_SIZE} total={visibleRows.length} label="Переводы Ozon" busy={loading} onPageChange={setPage} />
  </section>;
}
