import { ResourcePage } from "@/components/resource-page";
import { OzonSyncButton } from "@/components/ozon-sync-button";

export default function SalesPage() {
  return <ResourcePage config={{
    title: "Продажи и заказы", eyebrow: "Ozon FBO",
    description: "Итог Ozon и прибыль после себестоимости по каждому финальному отправлению. Себестоимость возвращённого товара не вычитается.",
    collectionUrl: "/api/orders", createUrl: "/api/orders", hideCreate: true,
    remotePageSize: 50,
    filterOptionsUrl: "/api/orders?filterOptions=1",
    showOrderSummary: true,
    fields: [],
    columns: [
      { key: "externalId", label: "Отправление", kind: "identifier", primary: true, linkToOzonPosting: true }, { key: "orderDate", label: "Создан", kind: "date" },
      { key: "status", label: "Статус", kind: "status" },
      { key: "article", label: "Артикул" },
      { key: "amount", label: "Итог Ozon", kind: "money" },
      { key: "addedCostRatePercent", label: "Добавочная стоимость", kind: "percent", filterable: false, titleField: "addedCostExplanation" },
      { key: "profit", label: "Прибыль после себестоимости", kind: "money" },
    ],
    emptyTitle: "Заказов пока нет", emptyDescription: "Нажмите «Синхронизировать продажи», чтобы загрузить заказы, статусы и суммы.",
  }} actions={<OzonSyncButton kind="orders" label="Синхронизировать продажи" completedMessage="Заказы, статусы и связанные денежные суммы обновлены." />} />;
}
