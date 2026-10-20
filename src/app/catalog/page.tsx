"use client";

import { ProductArchiveAction } from "@/components/product-archive-action";
import { ResourcePage } from "@/components/resource-page";

export default function CatalogPage() {
  return <ResourcePage rowActions={(row, refresh) => <ProductArchiveAction row={row} refresh={refresh} />} config={{
    title: "Каталог товаров", eyebrow: "Справочники",
    description: "Единый список товаров и их артикулов. Связи с Ozon нужны для автоматического распознавания заказов и возвратов.",
    collectionUrl: "/api/products", createUrl: "/api/products", createLabel: "Добавить товар",
    fields: [
      { name: "sku", label: "Внутренний артикул *", required: true, placeholder: "Например, BAG-001" },
      { name: "title", label: "Название товара *", required: true, wide: true },
      { name: "category", label: "Категория", placeholder: "Например, аксессуары" },
      { name: "offerId", label: "Артикул Ozon" },
      { name: "ozonSku", label: "SKU Ozon" },
    ],
    columns: [
      { key: "sku", label: "Артикул", primary: true }, { key: "title", label: "Название" }, { key: "category", label: "Категория" }, { key: "archived", label: "Статус" },
      { key: "sellerStock", label: "Мой склад", kind: "quantity" }, { key: "ozonStock", label: "Склад Ozon", kind: "quantity" },
      { key: "landedUnitCost", label: "Полная себестоимость", kind: "money" },
    ],
    emptyTitle: "Каталог пока пуст", emptyDescription: "Добавьте первый товар — после этого можно будет вносить закупки, поставки и находить связанные операции Ozon.",
  }} />;
}
