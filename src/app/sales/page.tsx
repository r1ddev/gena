import { ResourcePage } from "@/components/resource-page";
import { OzonSyncButton } from "@/components/ozon-sync-button";

export default function SalesPage() {
  return <ResourcePage config={{
    title: "Продажи и заказы", eyebrow: "Ozon FBO",
    description: "Здесь показаны сохранённые заказы, статусы и начисления. «Синхронизировать с Ozon» загружает заказы и статусы, возвраты, отчёты о выкупах, начисления и списания. «Перечитать из базы» обновляет этот список без запроса к Ozon. До истечения 21 дня после доставки заказ показан как предварительный.",
    collectionUrl: "/api/orders", createUrl: "/api/orders", hideCreate: true,
    fields: [],
    columns: [
      { key: "externalId", label: "Отправление", primary: true }, { key: "orderDate", label: "Создан", kind: "date" },
      { key: "status", label: "Статус", kind: "status" }, { key: "deliveredAt", label: "Доставлен", kind: "date" },
      { key: "phase", label: "Учёт", kind: "status" }, { key: "items", label: "Товары" }, { key: "amount", label: "Начисления", kind: "money" },
    ],
    emptyTitle: "Заказов пока нет", emptyDescription: "Нажмите «Синхронизировать с Ozon», чтобы загрузить отправления и их статусы.",
  }} actions={<OzonSyncButton />} />;
}
