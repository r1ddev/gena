import { OzonSyncButton } from "@/components/ozon-sync-button";
import { PageHeader } from "@/components/page-header";
import { PayoutsWorkspace } from "@/components/payouts-workspace";

export default function PayoutsPage() {
  return <>
    <PageHeader
      eyebrow="Деньги и затраты"
      title="Выплаты Ozon"
      description="Фактические переводы и сверка начислений с товарами из каталога."
      actions={<OzonSyncButton kind="payouts_full" label="Обновить выплаты" completedMessage="Выплаты обновлены." />}
    />
    <PayoutsWorkspace />
  </>;
}
