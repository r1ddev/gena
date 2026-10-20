"use client";

import { ResourcePage } from "@/components/resource-page";

export default function ExpensesPage() {
  return <ResourcePage config={{
    title: "Общие расходы", eyebrow: "Деньги и затраты",
    description: "Вносите расходы бизнеса: сумма сразу уменьшает расчётный баланс и участвует в общем коэффициенте полной себестоимости.",
    collectionUrl: "/api/expenses", createUrl: "/api/expenses", createLabel: "Добавить расход",
    fields: [
      { name: "spentAt", label: "Дата расхода *", type: "date", required: true },
      { name: "description", label: "Что *", required: true, placeholder: "Например, упаковка" },
      { name: "amount", label: "Сумма, ₽ *", type: "number", step: "0.01", required: true },
      { name: "note", label: "Комментарий", type: "textarea", wide: true },
    ],
    columns: [{ key: "spentAt", label: "Дата", kind: "date" }, { key: "description", label: "Что", primary: true }, { key: "note", label: "Комментарий" }, { key: "amount", label: "Сумма", kind: "money" }],
    editUrl: (row) => typeof row.id === "string" ? `/api/expenses?id=${encodeURIComponent(row.id)}` : null,
    deleteUrl: (row) => typeof row.id === "string" ? `/api/expenses?id=${encodeURIComponent(row.id)}` : null,
    emptyDescription: "Добавьте расход. Удаление ошибочной записи убирает её влияние из баланса и расчёта себестоимости.",
  }} />;
}
