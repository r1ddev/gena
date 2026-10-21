"use client";

import { ResourcePage } from "@/components/resource-page";

export default function WriteoffsPage() {
  return <ResourcePage config={{
    title: "Списания", eyebrow: "Складские операции",
    description: "Ручное списание уменьшает мой склад без повторного денежного расхода. Списания Ozon приходят из синхронизации. Указанная Ozon компенсация пока служит данными для сверки: в баланс и прибыль включаются финансовые начисления, а отдельное сопоставление компенсации ещё не подтверждено.",
    collectionUrl: "/api/writeoffs", createUrl: "/api/writeoffs", createLabel: "Списать со своего склада",
    fields: [
      { name: "productId", label: "Товар *", type: "select", optionsFrom: "/api/products", required: true },
      { name: "writtenOffAt", label: "Дата списания *", type: "date", required: true },
      { name: "quantity", label: "Количество *", type: "number", step: "1", min: "1", required: true },
      { name: "note", label: "Причина или комментарий", type: "textarea", wide: true },
    ],
    columns: [
      { key: "writtenOffAt", label: "Дата", kind: "date" }, { key: "title", label: "Товар", primary: true },
      { key: "sku", label: "Артикул" }, { key: "quantity", label: "Количество", kind: "quantity" },
      { key: "compensationStatus", label: "Компенсация Ozon", kind: "status" }, { key: "compensationAmount", label: "Сумма", kind: "money" }, { key: "note", label: "Комментарий" },
    ],
    deleteUrl: (row) => row.kind === "manual" && typeof row.id === "string" ? `/api/writeoffs?id=${encodeURIComponent(row.id)}` : null,
    emptyTitle: "Списаний пока нет", emptyDescription: "Создайте ручное списание, если товар пропал с вашего склада. Ozon-списания появятся после синхронизации.",
  }} />;
}
