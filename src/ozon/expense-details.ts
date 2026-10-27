import { financeAccrualRelatedSkus, ozonExpenseLabel } from "./finance";

type FinanceExpenseRow = {
  externalKey: string;
  accruedCategory: string;
  typeId: string;
  amount: string | number;
  relatedSkus?: string[] | null;
  raw: Record<string, unknown>;
};

export type FinanceExpenseComponent = {
  typeId: string;
  label: string;
  amount: number;
  sku: string | null;
  quantity: number | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((row): row is Record<string, unknown> => row !== null) : [];
}

function feeAmount(value: unknown) {
  const accrued = record(value);
  const rawAmount = accrued?.amount ?? value;
  const amount = Number(rawAmount);
  return Number.isFinite(amount) ? amount : null;
}

function optionalQuantity(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : null;
}

export function financeExpenseComponents(row: FinanceExpenseRow): FinanceExpenseComponent[] {
  const category = row.accruedCategory.toUpperCase();
  const targetSkus = new Set(financeAccrualRelatedSkus(row));
  const sourceRows = category === "ITEM"
    ? rows(record(row.raw.item_fees)?.fees)
    : category === "NON_ITEM"
      ? rows(record(row.raw.container_fees)?.fees)
      : [];

  return sourceRows.flatMap((sourceRow) => {
    const sku = category === "ITEM" && sourceRow.sku !== undefined && sourceRow.sku !== null
      ? String(sourceRow.sku).trim()
      : "";
    if (category === "ITEM" && (!sku || !targetSkus.has(sku))) return [];
    const fees = rows(sourceRow.fees ?? [sourceRow]);
    return fees.flatMap((fee) => {
      const typeId = String(fee.type_id ?? "");
      if (typeId !== row.typeId) return [];
      const amount = feeAmount(fee.accrued);
      if (amount === null) return [];
      return [{
        typeId,
        label: ozonExpenseLabel(typeId, {}, category),
        amount,
        sku: sku || null,
        quantity: category === "ITEM" ? optionalQuantity(sourceRow.quantity) : null,
      }];
    });
  });
}
