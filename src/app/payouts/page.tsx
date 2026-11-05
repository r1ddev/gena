"use client";

import { useState } from "react";
import { ResourcePage } from "@/components/resource-page";
import { OzonSyncButton } from "@/components/ozon-sync-button";
import { requestJson } from "@/components/api";

function dateLabel(value: unknown) {
  const [year, month, day] = String(value ?? "").slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : "—";
}

function payoutAmount(row: Record<string, unknown>) {
  const amount = Number(row.amount ?? 0);
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  const formatted = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Math.abs(amount));
  const currency = row.currencyCode === "RUB" ? "₽" : String(row.currencyCode ?? "");
  return `${sign}${formatted} ${currency}`;
}

function PayoutAccountingAction({ row, refresh }: { row: Record<string, unknown>; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const excluded = row.excludedFromAccounting === true;

  async function toggleAccounting() {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id || busy) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/payouts?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ excludedFromAccounting: !excluded }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить выплату.");
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ display: "grid", justifyItems: "start", gap: 5 }}>
    <button type="button" className="button secondary small" onClick={() => void toggleAccounting()} disabled={busy || !row.id}>
      {busy ? "Сохраняем…" : excluded ? "Вернуть в расчёт" : "Исключить из расчёта"}
    </button>
    {error && <span className="small-note" role="alert">{error}</span>}
  </div>;
}

export default function PayoutsPage() {
  return <ResourcePage config={{
    title: "Выплаты Ozon",
    eyebrow: "Деньги и затраты",
    description: "Сумма выплаты и период отчёта Ozon.",
    collectionUrl: "/api/payouts",
    createUrl: "/api/payouts",
    hideCreate: true,
    fields: [],
    columns: [
      {
        key: "period",
        label: "Период Ozon",
        primary: true,
        sortable: true,
        filterable: false,
        value: (row) => `${row.periodBegin ?? ""} ${row.periodEnd ?? ""}`,
        render: (row) => <span className="table-primary">{dateLabel(row.periodBegin)} — {dateLabel(row.periodEnd)}</span>,
      },
      {
        key: "amount",
        label: "Выплата",
        sortable: true,
        filterable: false,
        render: (row) => {
          const amount = Number(row.amount ?? 0);
          return <span className="number" style={{ color: amount < 0 ? "var(--red)" : "var(--green-dark)", fontWeight: 700 }}>{payoutAmount(row)}</span>;
        },
      },
      {
        key: "accountingStatus",
        label: "Учёт",
        filterable: false,
        render: (row) => <span className={`badge ${row.excludedFromAccounting === true ? "orange" : "green"}`}>
          {row.excludedFromAccounting === true ? "Исключена" : "В учёте"}
        </span>,
      },
    ],
    emptyTitle: "Выплат пока нет",
    emptyDescription: "Выплаты появятся после синхронизации данных Ozon.",
  }}
    rowActions={(row, refresh) => <PayoutAccountingAction key={String(row.id)} row={row} refresh={refresh} />}
    actions={<OzonSyncButton kind="payouts_full" label="Синхронизировать выплаты" completedMessage="Список выплат обновлён." />}
  />;
}
