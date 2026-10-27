export const scenarioFields = [
  { id: "purchase", label: "Закупка, ₽", format: "money" },
  { id: "sale", label: "Продажа, ₽", format: "money" },
  { id: "outboundDelivery", label: "Доставка туда, ₽", format: "money" },
  { id: "returnDelivery", label: "Доставка обратно, ₽", format: "money" },
  { id: "acquiring", label: "Эквайринг, ₽", format: "money" },
  { id: "commission", label: "Комиссия, %", format: "percentage" },
  { id: "promotion", label: "Продвижение, %", format: "percentage" },
  { id: "successRate", label: "Процент успешных, %", format: "percentage" },
  { id: "additionalCost", label: "Доп. стоимость, %", format: "percentage" },
] as const;

export type ScenarioFieldId = (typeof scenarioFields)[number]["id"];
export type ScenarioInputs = Record<ScenarioFieldId, string>;
export type ScenarioParameters = Record<ScenarioFieldId, number>;
export type ScenarioResult = { profit: number; profitShare: number };

export const initialScenarioInputs: ScenarioInputs = {
  purchase: "50",
  sale: "200",
  outboundDelivery: "31",
  returnDelivery: "31",
  acquiring: "3",
  commission: "20",
  promotion: "0",
  successRate: "60",
  additionalCost: "40",
};

export function parseScenarioValue(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateScenario(values: ScenarioParameters): ScenarioResult | null {
  const sale = values.sale;
  const successRate = values.successRate;
  if (sale <= 0 || successRate <= 0 || successRate > 100) return null;

  const successfulDeliveryShare = successRate / 100;
  const profit = sale
    - values.purchase * (1 + values.additionalCost / 100)
    - values.outboundDelivery
    - values.acquiring
    - sale * values.commission / 100
    - sale * values.promotion / 100
    - ((1 - successfulDeliveryShare) / successfulDeliveryShare)
      * (values.outboundDelivery + values.returnDelivery);

  return { profit, profitShare: profit / sale * 100 };
}
