import { describe, expect, it } from "vitest";
import { findPreviouslyAppliedBatch } from "./content-guard";

describe("findPreviouslyAppliedBatch", () => {
  it("blocks applying a second preview with identical file content", () => {
    expect(findPreviouslyAppliedBatch(
      { id: "preview-2", contentHash: "same-file" },
      [{ id: "applied-1", contentHash: "same-file", status: "applied" }],
    )).toEqual({ id: "applied-1", contentHash: "same-file", status: "applied" });
  });

  it("allows different content and ignores the current batch", () => {
    expect(findPreviouslyAppliedBatch(
      { id: "preview-1", contentHash: "same-file" },
      [
        { id: "preview-1", contentHash: "same-file", status: "applied" },
        { id: "other", contentHash: "different-file", status: "applied" },
      ],
    )).toBeUndefined();
  });
});
