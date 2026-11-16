"use client";

import { ResourcePage } from "@/components/resource-page";

export default function ExpensesPage() {
  return <ResourcePage config={{
    title: "Мои расходы", eyebrow: "Деньги и затраты",
    description: "Расходы, которые ты добавляешь вручную. Они входят в добавочную стоимость товаров. Операции Ozon вынесены в отдельный раздел.",
    collectionUrl: "/api/expenses?source=mine", createUrl: "/api/expenses", createLabel: "Добавить расход",
    fields: [
      { name: "spentAt", label: "Дата расхода *", type: "date", required: true },
      { name: "description", label: "Что *", required: true, placeholder: "Например, упаковка" },
      { name: "amount", label: "Сумма, ₽ *", type: "number", step: "0.01", required: true },
      { name: "note", label: "Комментарий", type: "textarea", wide: true },
    ],
    columns: [{ key: "spentAt", label: "Дата", kind: "date" }, { key: "description", label: "Что", primary: true }, { key: "note", label: "Комментарий" }, { key: "amount", label: "Сумма", kind: "money" }],
    editUrl: (row) => row.source === "mine" && typeof row.id === "string" ? `/api/expenses?id=${encodeURIComponent(row.id)}` : null,
    deleteUrl: (row) => row.source === "mine" && typeof row.id === "string" ? `/api/expenses?id=${encodeURIComponent(row.id)}` : null,
    emptyDescription: "Добавьте свой расход — он будет учтён в балансе и добавочной стоимости товаров.",
  }} />;
}
