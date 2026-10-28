import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { handleLocalGet } from "../_lib/http";

const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const params = new URL(request.url).searchParams;
    const requestedPage = Number(params.get("page"));
    const requestedPageSize = Number(params.get("pageSize"));
    const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, MAX_PAGE_SIZE)
      : 50;
    const query = (params.get("q") ?? "").trim().slice(0, 120).toLocaleLowerCase("ru-RU");
    const snapshot = await getAccountingSnapshot(new Date(), true);
    // Keep the reducer order: it is the sequence that changes the balances.
    const operations = (snapshot.addedCostOperations ?? []).filter((operation) => {
      if (!query) return true;
      return [operation.title, operation.details, operation.postingNumber, operation.orderNumber, operation.sourceNumber, operation.productSku, operation.productTitle, operation.note, operation.status]
        .some((value) => value?.toLocaleLowerCase("ru-RU").includes(query));
    });
    const total = operations.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1), totalPages);
    const start = (page - 1) * pageSize;
    return {
      items: operations.slice(start, start + pageSize),
      pagination: { page, pageSize, total, totalPages },
    };
  });
}
