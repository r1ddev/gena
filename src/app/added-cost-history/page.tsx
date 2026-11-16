import { PageHeader } from "@/components/page-header";
import { AddedCostHistoryWorkspace } from "@/components/added-cost-history-workspace";

export default function AddedCostHistoryPage() {
  return <>
    <PageHeader
      eyebrow="Расчёт"
      title="История добавочной стоимости"
      description="Операции идут в том порядке, в котором меняют расчёт: от ранних к поздним. Для заказа показаны и дата заказа, и дата, когда он повлиял на расходы и остатки."
    />
    <AddedCostHistoryWorkspace />
  </>;
}
