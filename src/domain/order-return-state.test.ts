import { describe, expect, it } from "vitest";
import { getOrderReturnStatesByPosting } from "./order-return-state";

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
