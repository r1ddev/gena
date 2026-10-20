import { ResourcePage } from "@/components/resource-page";
import { OzonSyncButton } from "@/components/ozon-sync-button";

export default function SalesPage() {
  return <ResourcePage config={{
    title: "Продажи и заказы", eyebrow: "Ozon FBO",
    description: "Отправления Ozon: статус, артикулы и денежный итог по каждому отправлению.",
    collectionUrl: "/api/orders", createUrl: "/api/orders", hideCreate: true,
    hideRefresh: true,
    remotePageSize: 50,
    fields: [],
    columns: [
      { key: "externalId", label: "Отправление", primary: true }, { key: "orderDate", label: "Создан", kind: "date" },
      { key: "status", label: "Статус", kind: "status" },
      { key: "article", label: "Артикул" }, { key: "amount", label: "Денежный итог", kind: "money" },
    ],
    emptyTitle: "Заказов пока нет", emptyDescription: "Нажмите «Синхронизировать продажи», чтобы загрузить заказы, статусы и суммы.",
  }} actions={<OzonSyncButton kind="orders" label="Синхронизировать продажи" completedMessage="Заказы, статусы и связанные денежные суммы обновлены." />} />;
}
