import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn(), update: vi.fn() },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/domain/accounting-repository", () => ({ getAccountingSnapshot: vi.fn() }));

import { PATCH } from "./route";

const existingReturn = {
  id: "return-row-1",
  externalId: "return-1",
  productId: "product-1",
  manualReconciliationFields: [],
  note: "",
};

function mockReturnUpdate(savedNote: string) {
  const selectLimit = vi.fn().mockResolvedValue([existingReturn]);
  dbMock.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: selectLimit }) }),
  });

  const returning = vi.fn().mockResolvedValue([{ ...existingReturn, note: savedNote }]);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  dbMock.update.mockReturnValue({ set: updateSet });

  return { updateSet };
}

function patchReturn(body: unknown) {
  return PATCH(new Request("http://localhost:3100/api/returns?id=return-row-1", {
    method: "PATCH",
    headers: { host: "localhost:3100", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("PATCH /api/returns note", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves and returns a manual note for the return", async () => {
    const note = "В споре Ozon подтвердил компенсацию";
    const { updateSet } = mockReturnUpdate(note);

    const response = await patchReturn({ note });

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ note }));
    await expect(response.json()).resolves.toMatchObject({ item: { note } });
  });

  it("allows clearing a previously saved note", async () => {
    const { updateSet } = mockReturnUpdate("");

    const response = await patchReturn({ note: "" });

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ note: "" }));
  });

  it("rejects notes longer than 2000 characters", async () => {
    const response = await patchReturn({ note: "x".repeat(2001) });

    expect(response.status).toBe(400);
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});
