import { isOzonWriteOffStatus, ozonReturnStatusLabel } from "@/ozon/return-status";

type Posting = { id: string; externalId: string };
type ReturnRow = {
  postingNumber: string | null;
  destination: "seller" | "ozon" | "unknown";
  status?: string | null;
  raw?: unknown;
  receivedBySellerAt: Date | null;
  availableAtOzon?: Date | null;
  writtenOffAt?: Date | null;
};

export function hasRestockedReturn(row: Pick<ReturnRow, "destination" | "receivedBySellerAt" | "availableAtOzon" | "writtenOffAt" | "status" | "raw">) {
  if (row.writtenOffAt || isOzonWriteOffStatus(row.status, row.raw)) return false;
  if (row.destination === "seller") return Boolean(row.receivedBySellerAt);
  if (row.destination === "ozon") return Boolean(row.availableAtOzon);
  return false;
}

export function getOrderReturnStatesByPosting(
  postings: Posting[],
  returnRows: ReturnRow[],
): Map<string, string> {
  const postingNumbers = new Set(postings.map((posting) => posting.externalId));
  const statesByPosting = new Map<string, Set<string>>();

  for (const row of returnRows) {
    if (!row.postingNumber || !postingNumbers.has(row.postingNumber)) continue;
    if (isOzonWriteOffStatus(row.status, row.raw)) {
      statesByPosting.set(row.postingNumber, new Set([...(statesByPosting.get(row.postingNumber) ?? []), "Списание Ozon"]));
      continue;
    }
    const statusLabel = ozonReturnStatusLabel(row.status, row.raw);

    const state = row.destination === "seller"
      ? row.receivedBySellerAt
        ? "Возврат получен мной"
        : row.status && row.status !== "unknown"
          ? `Возврат мне · ${statusLabel} · получение не отмечено`
          : "Возврат едет ко мне · получение не отмечено"
      : row.destination === "ozon"
        ? row.status && row.status !== "unknown" ? `Возврат на Ozon · ${statusLabel}` : "Возврат на Ozon"
        : "Возврат · место не определено";
    statesByPosting.set(row.postingNumber, new Set([...(statesByPosting.get(row.postingNumber) ?? []), state]));
  }

  return new Map([...statesByPosting].map(([postingNumber, states]) => [postingNumber, [...states].join("; ")]));
}

const postingStatusLabels: Record<string, string> = {
  delivered: "Доставлен",
  cancelled: "Отменён",
  canceled: "Отменён",
  delivering: "Доставляется",
  awaiting_deliver: "Ожидает доставки",
  awaiting_packaging: "Ожидает сборки",
};

export function currentOrderStatus(postingStatus: string, returnState: string | null | undefined) {
  const normalizedStatus = postingStatus.trim().toLocaleLowerCase("ru-RU").replace(/[\s-]+/g, "_");
  if (/cancel|отмен|declin|reject/i.test(normalizedStatus)) return postingStatusLabels[normalizedStatus] ?? "Отменён";
  if (!returnState) return postingStatusLabels[postingStatus.toLowerCase()] ?? postingStatus;

  const states = returnState.split(";").map((state) => state.trim()).filter(Boolean);
  const hasWriteoff = states.includes("Списание Ozon");
  const hasReturn = states.some((state) => state.startsWith("Возврат"));
  if (hasWriteoff && hasReturn) return "Возврат и списание";
  if (hasWriteoff) return "Списание Ozon";
  return "Возврат";
}
