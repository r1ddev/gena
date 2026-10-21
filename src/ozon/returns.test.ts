import { describe, expect, it } from "vitest";
import { chooseReturnPostingNumber } from "./returns";

describe("chooseReturnPostingNumber", () => {
  const valid = (number: string) => number === "matching-posting";

  it("preserves a validated manual link when Ozon omits a posting number", () => {
    expect(chooseReturnPostingNumber(null, "matching-posting", valid)).toBe("matching-posting");
  });

  it("preserves a validated manual link when the incoming posting does not contain the product", () => {
    expect(chooseReturnPostingNumber("wrong-posting", "matching-posting", valid)).toBe("matching-posting");
  });

  it("prefers an incoming posting when it is validated against the returned product", () => {
    expect(chooseReturnPostingNumber("matching-posting", "old-posting", valid)).toBe("matching-posting");
  });

  it("keeps an incoming unresolved number visible when no validated link exists", () => {
    expect(chooseReturnPostingNumber("wrong-posting", null, valid)).toBe("wrong-posting");
  });

  it("preserves a manually overridden posting number during sync", () => {
    expect(chooseReturnPostingNumber("different-matching-posting", "matching-posting", valid, true)).toBe("matching-posting");
    expect(chooseReturnPostingNumber("matching-posting", null, valid, true)).toBe(null);
  });
});
