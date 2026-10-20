import { ResourcePage } from "@/components/resource-page";
import { RefreshSalesButton } from "@/components/refresh-sales-button";

export default function SalesPage() {
  return <ResourcePage config={{
    title: "Продажи и заказы", eyebrow: "Ozon FBO",
    description: "Загруженные отправления и финансовые начисления. До истечения 21 дня после доставки заказ показан как предварительный.",
    collectionUrl: "/api/orders", createUrl: "/api/orders", hideCreate: true,
    fields: [],
    columns: [
      { key: "externalId", label: "Отправление", primary: true }, { key: "orderDate", label: "Создан", kind: "date" },
      { key: "status", label: "Статус", kind: "status" }, { key: "deliveredAt", label: "Доставлен", kind: "date" },
      { key: "phase", label: "Учёт", kind: "status" }, { key: "items", label: "Товары" }, { key: "amount", label: "Начисления", kind: "money" },
    ],
    emptyTitle: "Заказов пока нет", emptyDescription: "Запустите синхронизацию в настройках, чтобы загрузить отправления и их статусы из Ozon.",
  }} actions={<RefreshSalesButton />} />;
}
