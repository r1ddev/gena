import { describe, expect, it } from "vitest";
import { getImportedBuyerDeliveryDate, getSaleAmountImportIssue, isDeliveredSaleStatus, isImportableSaleMovement, isMarketplaceBuyoutStatus } from "./sales";

describe("sale status classification", () => {
  it("recognizes delivered statuses without treating refusals as deliveries", () => {
    expect(isDeliveredSaleStatus("Доставлен")).toBe(true);
    expect(isDeliveredSaleStatus("Заказ доставлен покупателю")).toBe(true);
    expect(isDeliveredSaleStatus("not delivered")).toBe(false);
    expect(isDeliveredSaleStatus("Не доставлен")).toBe(false);
    expect(isDeliveredSaleStatus("Не выкуплен")).toBe(false);
    expect(isDeliveredSaleStatus("Выкуплен маркетплейсом")).toBe(false);
    expect(isDeliveredSaleStatus("Отменен")).toBe(false);
    expect(isDeliveredSaleStatus("Возврат покупателем")).toBe(false);
  });

  it("recognizes only an explicit marketplace buyout status", () => {
    expect(isMarketplaceBuyoutStatus("Выкуплен маркетплейсом")).toBe(true);
    expect(isMarketplaceBuyoutStatus("Marketplace buyout")).toBe(true);
    expect(isMarketplaceBuyoutStatus("Не выкуплен маркетплейсом")).toBe(false);
  });
});

describe("getImportedBuyerDeliveryDate", () => {
  it("uses an explicit buyer handoff date and does not guess from a generic date column", () => {
    expect(getImportedBuyerDeliveryDate({ дата: "2026-10-01", датадоставкипокупателю: "2026-10-10" })).toBe("2026-10-10");
    expect(getImportedBuyerDeliveryDate({ дата: "2026-10-01" })).toBeNull();
  });
});

describe("getSaleAmountImportIssue", () => {
  it("keeps negative or missing delivered sale amounts out of accounting until reconciled", () => {
    expect(getSaleAmountImportIssue(-125.5, "Доставлен")).toBe("negative");
    expect(getSaleAmountImportIssue(null, "Доставлен")).toBe("missing");
    expect(getSaleAmountImportIssue(0, "Доставлен")).toBeNull();
    expect(getSaleAmountImportIssue(125.5, "Доставлен")).toBeNull();
  });

  it("allows cancelled rows without amounts and buyouts awaiting their finance report", () => {
    expect(getSaleAmountImportIssue(null, "Отменен")).toBeNull();
    expect(getSaleAmountImportIssue(null, "Выкуплен маркетплейсом")).toBeNull();
  });
});

describe("isImportableSaleMovement", () => {
  it("marks delivered sales and marketplace buyouts as stock movements", () => {
    expect(isImportableSaleMovement("Доставлен")).toBe(true);
    expect(isImportableSaleMovement("Выкуплен маркетплейсом")).toBe(true);
    expect(isImportableSaleMovement("Отменен")).toBe(false);
    expect(isImportableSaleMovement("Возврат покупателем")).toBe(false);
  });
});
