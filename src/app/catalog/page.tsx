"use client";

import { ResourcePage } from "@/components/resource-page";

export default function CatalogPage() {
  return <ResourcePage config={{
    title: "Каталог товаров",
    description: "Список товаров с артикулами и SKU Ozon.",
    collectionUrl: "/api/products", createUrl: "/api/products", createLabel: "Добавить товар",
    deleteUrl: (row) => typeof row.id === "string" ? `/api/products/${encodeURIComponent(row.id)}` : null,
    deleteConfirm: "Удалить товар из каталога? Если есть связанные операции, перед удалением покажу их список и предложу перераспределить.",
    deleteSuccess: "Товар удалён из каталога.",
    editUrl: (row) => typeof row.id === "string" ? `/api/products/${encodeURIComponent(row.id)}` : null,
    imageUpload: true,
    fields: [
      { name: "offerId", label: "Артикул *", placeholder: "Артикул продавца", required: true },
      { name: "title", label: "Название товара *", required: true, wide: true },
      { name: "ozonSku", label: "SKU Ozon *", required: true },
    ],
    help: "Укажите артикул продавца и SKU Ozon.",
    columns: [
      { key: "offerId", label: "Артикул", primary: true }, { key: "ozonSku", label: "SKU Ozon" }, { key: "title", label: "Название" },
      { key: "sellerStock", label: "Мой склад", kind: "quantity" }, { key: "ozonStock", label: "Склад Ozon", kind: "quantity" },
      { key: "landedUnitCost", label: "Полная себестоимость", kind: "money" },
    ],
    emptyTitle: "Каталог пока пуст", emptyDescription: "Добавьте первый товар — после этого можно будет вносить закупки, поставки и находить связанные операции Ozon.",
  }} />;
}
