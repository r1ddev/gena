import { ResourcePage } from "@/components/resource-page";
import { OzonSyncButton } from "@/components/ozon-sync-button";

export default function SalesPage() {
  return <ResourcePage config={{
    title: "Продажи и заказы", eyebrow: "Ozon FBO",
    description: "Заказы, их статусы и денежный итог по каждому отправлению. Сопоставленный возврат отображается у своего заказа; остальные возвраты находятся в разделе «Возвраты». Сумма складывается из начислений и удержаний Ozon по отправлению. Данные и связанные суммы обновляются кнопкой здесь. До истечения 21 дня после доставки заказ показан как предварительный.",
    collectionUrl: "/api/orders", createUrl: "/api/orders", hideCreate: true,
    hideRefresh: true,
    remotePageSize: 50,
    fields: [],
    columns: [
      { key: "externalId", label: "Отправление", primary: true }, { key: "orderDate", label: "Создан", kind: "date" },
      { key: "status", label: "Статус", kind: "status" }, { key: "deliveredAt", label: "Доставлен", kind: "date" },
      { key: "phase", label: "Учёт", kind: "status" }, { key: "returnState", label: "Возврат", kind: "status" }, { key: "items", label: "Товары" }, { key: "amount", label: "Денежный итог", kind: "money" },
    ],
    emptyTitle: "Заказов пока нет", emptyDescription: "Нажмите «Синхронизировать продажи», чтобы загрузить заказы, статусы и суммы.",
  }} actions={<OzonSyncButton kind="orders" label="Синхронизировать продажи" completedMessage="Заказы, статусы и связанные денежные суммы обновлены." />} />;
}
