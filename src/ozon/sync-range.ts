const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_ACCOUNTING_START_DATE = "2025-10-20";

function utcStartOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isValidHistoryStartDate(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && parsed <= utcStartOfDay(now);
}

export function resolveOzonSyncRange(startDate: string, lastSyncAt: Date | null, now: Date) {
  if (!isValidHistoryStartDate(startDate, now)) throw new Error("Укажи корректную дату начала учёта в настройках.");
  const configuredStart = new Date(`${startDate}T00:00:00.000Z`);

  const incrementalStart = lastSyncAt ? utcStartOfDay(addUtcDays(lastSyncAt, -45)) : configuredStart;
  return {
    from: incrementalStart > configuredStart ? incrementalStart : configuredStart,
    to: now,
  };
}

export function splitUtcDateRange(from: Date, to: Date, maxDays: number) {
  if (!Number.isInteger(maxDays) || maxDays < 1) throw new Error("Размер периода должен быть положительным целым числом дней.");
  if (from > to) return [];

  const ranges: { from: Date; to: Date }[] = [];
  let rangeStart = utcStartOfDay(from);
  while (rangeStart <= to) {
    const exclusiveEnd = addUtcDays(rangeStart, maxDays);
    const rangeEnd = new Date(Math.min(exclusiveEnd.getTime() - 1, to.getTime()));
    ranges.push({ from: rangeStart, to: rangeEnd });
    if (rangeEnd.getTime() >= to.getTime()) break;
    rangeStart = utcStartOfDay(new Date(rangeEnd.getTime() + 1));
  }
  return ranges;
}
