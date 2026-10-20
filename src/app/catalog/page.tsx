"use client";

import { ProductArchiveAction } from "@/components/product-archive-action";
import { ResourcePage } from "@/components/resource-page";

export default function CatalogPage() {
  return <ResourcePage rowActions={(row, refresh) => <ProductArchiveAction row={row} refresh={refresh} />} config={{
    title: "Каталог товаров", eyebrow: "Справочники",
    description: "Единый список товаров и их артикулов. Связи с Ozon нужны для автоматического распознавания заказов и возвратов.",
    collectionUrl: "/api/products", createUrl: "/api/products", createLabel: "Добавить товар",
    fields: [
      { name: "offerId", label: "Артикул", placeholder: "Артикул продавца" },
      { name: "title", label: "Название товара *", required: true, wide: true },
      { name: "ozonSku", label: "SKU Ozon" },
    ],
    help: "Укажите артикул продавца или SKU Ozon.",
    columns: [
      { key: "offerId", label: "Артикул", primary: true }, { key: "ozonSku", label: "SKU Ozon" }, { key: "title", label: "Название" }, { key: "archived", label: "Статус" },
      { key: "sellerStock", label: "Мой склад", kind: "quantity" }, { key: "ozonStock", label: "Склад Ozon", kind: "quantity" },
      { key: "landedUnitCost", label: "Полная себестоимость", kind: "money" },
    ],
    emptyTitle: "Каталог пока пуст", emptyDescription: "Добавьте первый товар — после этого можно будет вносить закупки, поставки и находить связанные операции Ozon.",
  }} />;
}
