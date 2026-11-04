import { PageHeader } from "@/components/page-header";
import { AuditLogWorkspace } from "@/components/audit-log-workspace";

export default function AuditLogsPage() {
  return <>
    <PageHeader
      eyebrow="История изменений"
      title="Журнал действий"
      description="Добавления, изменения и удаления из сервиса и синхронизации Ozon."
    />
    <AuditLogWorkspace />
  </>;
}
