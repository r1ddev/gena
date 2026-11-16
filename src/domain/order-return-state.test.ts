import { describe, expect, it } from "vitest";
import { currentOrderStatus, getOrderReturnStatesByPosting, hasRestockedReturn } from "./order-return-state";

describe("getOrderReturnStatesByPosting", () => {
  const postings = [{ id: "posting-1", externalId: "posting-number-1" }];
  it("shows a seller return linked by posting number", () => {
    const states = getOrderReturnStatesByPosting(postings, [{
      postingNumber: "posting-number-1",
      destination: "seller",
      receivedBySellerAt: null,
    }]);

    expect(states.get("posting-number-1")).toBe("Возврат едет ко мне · получение не отмечено");
  });

  it("shows the order state when the return product is not linked", () => {
    const states = getOrderReturnStatesByPosting(postings, [{
      postingNumber: "posting-number-1",
      destination: "seller",
      receivedBySellerAt: null,
    }]);

    expect(states.get("posting-number-1")).toBe("Возврат едет ко мне · получение не отмечено");
  });

  it("shows the Ozon return status on its order instead of a stock restock state", () => {
    const states = getOrderReturnStatesByPosting(postings, [{
      postingNumber: "posting-number-1",
      destination: "ozon",
      status: "Не выкуплен",
      receivedBySellerAt: null,
    }]);

    expect(states.get("posting-number-1")).toBe("Возврат на Ozon · Не выкуплен");
  });
});

describe("hasRestockedReturn", () => {
  it("accepts a return only after it reaches the seller or Ozon warehouse", () => {
    expect(hasRestockedReturn({ destination: "seller", receivedBySellerAt: new Date(), availableAtOzon: null })).toBe(true);
    expect(hasRestockedReturn({ destination: "ozon", receivedBySellerAt: null, availableAtOzon: new Date() })).toBe(true);
    expect(hasRestockedReturn({ destination: "seller", receivedBySellerAt: null, availableAtOzon: null })).toBe(false);
  });

  it("does not count a written-off return as inventory", () => {
    expect(hasRestockedReturn({
      destination: "seller",
      receivedBySellerAt: new Date(),
      availableAtOzon: null,
      writtenOffAt: new Date(),
    })).toBe(false);
  });
});

describe("currentOrderStatus", () => {
  it("keeps a refused, undelivered shipment cancelled even after its package returns to the seller", () => {
    expect(currentOrderStatus("cancelled", "Возврат получен мной")).toBe("Отменён");
  });
});
