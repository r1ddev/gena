import { OzonSyncButton } from "@/components/ozon-sync-button";
import { PageHeader } from "@/components/page-header";
import { PayoutsWorkspace } from "@/components/payouts-workspace";

export default function PayoutsPage() {
  return <>
    <PageHeader
      eyebrow="Деньги и затраты"
      title="Выплаты Ozon"
      description="Сумма перевода, состав отчёта Ozon и начисления по отправлениям за тот же период."
      actions={<OzonSyncButton kind="payouts_full" label="Обновить расшифровки" completedMessage="Состав выплат обновлён." />}
    />
    <PayoutsWorkspace />
  </>;
}
