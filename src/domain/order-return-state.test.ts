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
      availableAtOzon: null,
    }]);

    expect(states.get("posting-number-1")).toBe("Возврат едет ко мне · получение не отмечено");
  });

  it("does not attach a return with an unmatched product to an order", () => {
    const states = getOrderReturnStatesByPosting(postings, postingItems, [{
      postingNumber: "posting-number-1",
      productId: "different-product",
      destination: "seller",
      receivedBySellerAt: null,
      availableAtOzon: null,
    }]);

    expect(states.has("posting-number-1")).toBe(false);
  });

  it("shows an Ozon return only after it is available for sale again", () => {
    const states = getOrderReturnStatesByPosting(postings, postingItems, [{
      postingNumber: "posting-number-1",
      productId: "product-1",
      destination: "ozon",
      receivedBySellerAt: null,
      availableAtOzon: new Date("2026-10-20T12:00:00Z"),
    }]);

    expect(states.get("posting-number-1")).toBe("Возврат снова доступен на Ozon");
  });
});
