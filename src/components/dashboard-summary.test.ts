import { describe, expect, it } from "vitest";
import { latestOzonSyncNotice, unmatchedItemsNotice } from "./dashboard-summary";

describe("unmatchedItemsNotice", () => {
  it("keeps unresolved Ozon items visible with the amount excluded from the balance", () => {
    expect(unmatchedItemsNotice(59, "573512.04")).toEqual({
      count: 59,
      excludedFinanceAmount: 573512.04,
      href: "#unmatched-ozon-items",
    });
  });

  it("does not show an action when there are no unresolved Ozon items", () => {
    expect(unmatchedItemsNotice(0, 0)).toBeNull();
  });
});

describe("latestOzonSyncNotice", () => {
  it("shows durable progress and counts from the active sync", () => {
    expect(latestOzonSyncNotice({
      status: "running",
      summary: {
        orders: 3989,
        returns: 1025,
        progress: "Начисления Ozon: 730 дней",
        accountingStartDate: "2025-10-20",
        queriedFrom: "2025-10-20T00:00:00.000Z",
        queriedTo: "2026-10-20T12:00:00.000Z",
      },
    })).toEqual({
      tone: "info",
      message: "Синхронизация Ozon выполняется. Период: 20.10.2025–20.10.2026. Начисления Ozon: 730 дней. Уже получено: отправления — 3989; возвраты — 1025.",
    });
  });

  it("reports an incomplete sync without exposing the raw Ozon error", () => {
    expect(latestOzonSyncNotice({
      status: "completed",
      error: "raw API rejection",
      summary: {
        orders: 3992,
        returns: 1025,
        queriedFrom: "2025-10-20T00:00:00.000Z",
        queriedTo: "2026-10-20T12:00:00.000Z",
      },
    })).toEqual({
      tone: "warning",
      message: "Синхронизация Ozon завершилась не полностью. Период: 20.10.2025–20.10.2026. Уже получено: отправления — 3992; возвраты — 1025.",
    });
  });
});
