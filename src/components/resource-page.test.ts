import { describe, expect, it } from "vitest";
import { buildResourcePayload, type FieldConfig } from "./resource-page";

describe("buildResourcePayload", () => {
  it("includes the visible default date in submissions when the user leaves it unchanged", () => {
    const fields: FieldConfig[] = [
      { name: "purchasedAt", label: "Дата закупки", type: "date", required: true },
      { name: "orderedQuantity", label: "Заказано", type: "number" },
      { name: "note", label: "Комментарий" },
    ];

    expect(buildResourcePayload(fields, { orderedQuantity: "2", note: "" }, "2026-10-20")).toEqual({
      purchasedAt: "2026-10-20",
      orderedQuantity: 2,
    });
  });

  it("keeps an explicitly selected date and numeric zero", () => {
    const fields: FieldConfig[] = [
      { name: "countedAt", label: "Дата", type: "date" },
      { name: "actualQuantity", label: "Фактически", type: "number" },
    ];

    expect(buildResourcePayload(fields, { countedAt: "2026-10-19", actualQuantity: "0" }, "2026-10-20")).toEqual({
      countedAt: "2026-10-19",
      actualQuantity: 0,
    });
  });
});
