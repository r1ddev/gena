import { ResourcePage } from "@/components/resource-page";
import { OzonSyncButton } from "@/components/ozon-sync-button";

export default function SalesPage() {
  return <ResourcePage config={{
    title: "Продажи и заказы", eyebrow: "Ozon FBO",
    description: "Здесь показаны заказы, их статусы и денежный итог по каждому отправлению: начисления и удержания Ozon. Сопоставленный возврат отображается у своего заказа; несопоставленные возвраты остаются в разделе «Возвраты». Денежный итог меняется по фактическим операциям Ozon, связанным с отправлением. «Синхронизировать с Ozon» обновляет заказы, суммы по ним, возвраты и другие операции Ozon, влияющие на деньги и остатки. «Перечитать из базы» показывает уже сохранённые данные. До истечения 21 дня после доставки заказ показан как предварительный.",
    collectionUrl: "/api/orders", createUrl: "/api/orders", hideCreate: true,
    fields: [],
    columns: [
      { key: "externalId", label: "Отправление", primary: true }, { key: "orderDate", label: "Создан", kind: "date" },
      { key: "status", label: "Статус", kind: "status" }, { key: "deliveredAt", label: "Доставлен", kind: "date" },
      { key: "phase", label: "Учёт", kind: "status" }, { key: "returnState", label: "Возврат", kind: "status" }, { key: "items", label: "Товары" }, { key: "amount", label: "Денежный итог", kind: "money" },
    ],
    emptyTitle: "Заказов пока нет", emptyDescription: "Нажмите «Синхронизировать с Ozon», чтобы загрузить отправления и их статусы.",
  }} actions={<OzonSyncButton />} />;
}
