type Posting = { id: string; externalId: string };
type PostingItem = { postingId: string; productId: string | null };
type ReturnRow = {
  postingNumber: string | null;
  productId: string | null;
  destination: "seller" | "ozon" | "unknown";
  status?: string | null;
  receivedBySellerAt: Date | null;
};

export function getOrderReturnStatesByPosting(
  postings: Posting[],
  postingItems: PostingItem[],
  returnRows: ReturnRow[],
): Map<string, string> {
  const postingIdByNumber = new Map(postings.map((posting) => [posting.externalId, posting.id]));
  const validReturnLinks = new Set(postingItems.flatMap((item) => item.productId ? [`${item.postingId}\u0000${item.productId}`] : []));
  const statesByPosting = new Map<string, Set<string>>();

  for (const row of returnRows) {
    if (!row.postingNumber || !row.productId) continue;
    const postingId = postingIdByNumber.get(row.postingNumber);
    if (!postingId || !validReturnLinks.has(`${postingId}\u0000${row.productId}`)) continue;

    const state = row.destination === "seller"
      ? row.receivedBySellerAt
        ? "Возврат получен мной"
        : row.status && row.status !== "unknown"
          ? `Возврат мне · ${row.status} · получение не отмечено`
          : "Возврат едет ко мне · получение не отмечено"
      : row.destination === "ozon"
        ? row.status && row.status !== "unknown" ? `Возврат на Ozon · ${row.status}` : "Возврат на Ozon"
        : "Возврат · место не определено";
    statesByPosting.set(row.postingNumber, new Set([...(statesByPosting.get(row.postingNumber) ?? []), state]));
  }

  return new Map([...statesByPosting].map(([postingNumber, states]) => [postingNumber, [...states].join("; ")]));
}
