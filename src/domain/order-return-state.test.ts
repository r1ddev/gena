import { describe, expect, it } from "vitest";
import { getOrderReturnStatesByPosting } from "./order-return-state";

describe("getOrderReturnStatesByPosting", () => {
  const postings = [{ id: "posting-1", externalId: "posting-number-1" }];
  const postingItems = [{ postingId: "posting-1", productId: "product-1" }];

  it("shows a seller return on its matching order and product", () => {
    const states = getOrderReturnStatesByPosting(postings, postingItems, [{
      postingNumber: "posting-number-1",
      productId: "product-1",
      destination: "seller",
      receivedBySellerAt: null,
    }]);

    expect(states.get("posting-number-1")).toBe("Возврат едет ко мне · получение не отмечено");
  });

  it("does not attach a return with an unmatched product to an order", () => {
    const states = getOrderReturnStatesByPosting(postings, postingItems, [{
      postingNumber: "posting-number-1",
      productId: "different-product",
      destination: "seller",
      receivedBySellerAt: null,
    }]);

    expect(states.has("posting-number-1")).toBe(false);
  });

  it("shows the Ozon return status on its order instead of a stock restock state", () => {
    const states = getOrderReturnStatesByPosting(postings, postingItems, [{
      postingNumber: "posting-number-1",
      productId: "product-1",
      destination: "ozon",
      status: "Не выкуплен",
      receivedBySellerAt: null,
    }]);

    expect(states.get("posting-number-1")).toBe("Возврат на Ozon · Не выкуплен");
  });
});
