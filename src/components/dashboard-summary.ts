export function unmatchedItemsNotice(unmatchedItemCount: number, excludedFinanceAmount: string | number | null | undefined) {
  const count = Math.max(0, Math.trunc(unmatchedItemCount));
  if (count === 0) return null;

  const amount = Number(excludedFinanceAmount ?? 0);
  return {
    count,
    excludedFinanceAmount: Number.isFinite(amount) ? amount : 0,
    href: "#unmatched-ozon-items",
  };
}

export function returnsNeedingAction<T extends { destination?: unknown; receivedBySellerAt?: unknown }>(rows: T[]) {
  return rows.filter((row) => row.destination === "unknown" || (row.destination === "seller" && !row.receivedBySellerAt));
}

export function latestOzonSyncNotice(jobValue: unknown) {
  if (!jobValue || typeof jobValue !== "object" || Array.isArray(jobValue)) return null;
  const job = jobValue as Record<string, unknown>;
  const summary = job.summary && typeof job.summary === "object" && !Array.isArray(job.summary)
    ? job.summary as Record<string, unknown>
    : {};
  const counts: string[] = [];
  if (typeof summary.orders === "number") counts.push(`отправления — ${summary.orders}`);
  if (typeof summary.returns === "number") counts.push(`возвраты — ${summary.returns}`);
  if (summary.accruals && typeof summary.accruals === "object") {
    const accrualCount = (summary.accruals as Record<string, unknown>).accruals;
    if (typeof accrualCount === "number") counts.push(`финансовые начисления — ${accrualCount}`);
  }
  if (typeof summary.writeoffs === "number") counts.push(`списания — ${summary.writeoffs}`);
  if (typeof summary.buyouts === "number") counts.push(`выкупы — ${summary.buyouts}`);
  const received = counts.length ? ` Уже получено: ${counts.join("; ")}.` : "";
  const rangeStart = formatDate(summary.queriedFrom);
  const rangeEnd = formatDate(summary.queriedTo);
  const range = rangeStart && rangeEnd ? ` Период: ${rangeStart}–${rangeEnd}.` : "";
  const sectionFailed = ["orders", "returns", "buyouts", "accruals", "writeoffs"].some((key) => summary[key] === "ошибка");
  const hasError = Boolean(job.error) || sectionFailed || (Array.isArray(summary.warnings) && summary.warnings.length > 0);

  if (job.status === "queued") return { tone: "info" as const, message: "Синхронизация Ozon ожидает запуска." };
  if (job.status === "running") {
    const progress = typeof summary.progress === "string" ? ` ${summary.progress}.` : "";
    const failure = sectionFailed ? " Один из разделов не обновился." : "";
    return { tone: hasError ? "warning" as const : "info" as const, message: `Синхронизация Ozon выполняется.${range}${progress}${failure}${received}` };
  }
  if (hasError) return { tone: "warning" as const, message: `Синхронизация Ozon завершилась не полностью.${range}${received}` };
  if (job.status === "completed") return { tone: "success" as const, message: `Синхронизация Ozon завершена.${range}${received}` };
  return null;
}

function formatDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
