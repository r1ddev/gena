"use client";

import { ResourcePage } from "@/components/resource-page";
import { OzonSyncButton } from "@/components/ozon-sync-button";

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

export default function PayoutsPage() {
  return <ResourcePage config={{
    title: "Выплаты Ozon",
    eyebrow: "Деньги и затраты",
    description: "Период — интервал отчёта Ozon, не дата зачисления на карту. Если период пересекает дату начала учёта, сумма входит в расчёт целиком.",
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
        key: "includedInAccounting",
        label: "Учёт",
        sortable: true,
        filterable: false,
        value: (row) => row.includedInAccounting ? "Входит в расчёт" : "До даты начала",
        render: (row) => <span className={`badge ${row.includedInAccounting ? "green" : "orange"}`}>
          {row.includedInAccounting ? "Входит в расчёт" : "До даты начала"}
        </span>,
      },
    ],
    emptyTitle: "Выплат пока нет",
    emptyDescription: "Выплаты появятся после синхронизации данных Ozon.",
  }} actions={<OzonSyncButton kind="payouts_full" label="Синхронизировать выплаты" completedMessage="Список выплат обновлён." />} />;
}
