"use client";

import { ResourcePage } from "@/components/resource-page";
import type { JsonRecord } from "@/components/api";

function productNumber(value: unknown) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

function productPercent(value: unknown) {
  const number = productNumber(value);
  return number === null ? "—" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(number)}%`;
}

function productQuantity(value: unknown) {
  const number = productNumber(value);
  return number === null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(number);
}

function productMoney(value: unknown) {
  const number = productNumber(value);
  if (number === null) return "—";
  const formatted = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(number));
  return `${number > 0 ? "+" : number < 0 ? "−" : ""}${formatted} ₽`;
}

function ProductSalesSummary({ row }: { row: JsonRecord }) {
  const successful = productNumber(row.successfulDeliveryQuantity);
  const attempts = productNumber(row.attemptedDeliveryQuantity);
  const profit = productNumber(row.profitPerUnit);
  const coveredPostings = productNumber(row.financeCoveredPostings);
  const relevantPostings = productNumber(row.financeRelevantPostings);
  const successfulShare = successful === null || attempts === null ? "—" : `${productQuantity(successful)} из ${productQuantity(attempts)} шт.`;
  const financeCoverage = coveredPostings === null || relevantPostings === null || relevantPostings === 0
    ? null
    : `Начисления: ${productQuantity(coveredPostings)} из ${productQuantity(relevantPostings)} отправлений`;
  return <div className="catalog-product-metrics" title="Процент успешных доставок = доставлено / заказы с уже известным исходом (доставлен или отменён); текущие заказы в расчёт не входят. Продано — доставки за вычетом возвратов, отмеченных как полученные вами. Прибыль за штуку — начисления и удержания Ozon по отправлениям с загруженными финансами за вычетом полной себестоимости. Общие суммы отправления с несколькими товарами распределены по стоимости товарных строк. Маржа — прибыль за штуку как доля выручки. Прочерк означает, что для расчёта не хватает данных.">
    <div><span>Успешные доставки</span><strong>{productPercent(row.deliverySuccessPercent)}</strong><small>{successfulShare}</small></div>
    <div><span>Продано</span><strong>{productQuantity(row.soldQuantity)} шт.</strong></div>
    <div><span>Прибыль / шт.</span><strong className={profit !== null && profit < 0 ? "negative" : profit !== null && profit > 0 ? "positive" : ""}>{productMoney(row.profitPerUnit)}</strong>{financeCoverage && <small>{financeCoverage}</small>}</div>
    <div><span>Маржа</span><strong>{productPercent(row.marginPercent)}</strong></div>
  </div>;
}

export default function CatalogPage() {
  return <ResourcePage config={{
      title: "Каталог товаров",
      description: "Список товаров с артикулами и SKU Ozon.",
      collectionUrl: "/api/products", createUrl: "/api/products", createLabel: "Добавить товар",
      deleteUrl: (row) => typeof row.id === "string" ? `/api/products/${encodeURIComponent(row.id)}` : null,
      deleteConfirm: "Удалить товар из каталога? История учёта сохранится.",
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
        { key: "salesMetrics", label: "Продажи и прибыль", filterable: false, render: (row) => <ProductSalesSummary row={row} /> },
      ],
      emptyTitle: "Каталог пока пуст", emptyDescription: "Добавьте первый товар — после этого можно будет вносить закупки, поставки и находить связанные операции Ozon.",
    }} />;
}
