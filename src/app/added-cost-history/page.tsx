import { PageHeader } from "@/components/page-header";
import { AddedCostHistoryWorkspace } from "@/components/added-cost-history-workspace";

export default function AddedCostHistoryPage() {
  return <>
    <PageHeader
      eyebrow="Расчёт"
      title="История добавочной стоимости"
      description="Заказы идут от новых к старым по дате заказа. В строках видно, как каждая операция изменила расходы в пуле и закупочную стоимость остатков."
    />
    <AddedCostHistoryWorkspace />
  </>;
}
