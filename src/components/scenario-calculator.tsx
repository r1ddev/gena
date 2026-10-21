"use client";

import { useMemo, useState } from "react";
import { Calculator, TrendingUp } from "lucide-react";
import { PageHeader } from "./page-header";

const rubles = (value: number) => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
}).format(value);

const percentage = (value: number) => new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
}).format(value) + "%";

const parseValue = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const fields = [
  { id: "purchase", label: "Закупка, ₽" },
  { id: "sale", label: "Продажа, ₽" },
  { id: "outboundDelivery", label: "Доставка туда, ₽" },
  { id: "returnDelivery", label: "Доставка обратно, ₽" },
  { id: "acquiring", label: "Эквайринг, ₽" },
  { id: "commission", label: "Комиссия, %" },
  { id: "promotion", label: "Продвижение, %" },
  { id: "successRate", label: "Процент успешных, %" },
  { id: "additionalCost", label: "Доп. стоимость, %" },
] as const;

type FieldId = (typeof fields)[number]["id"];
type Inputs = Record<FieldId, string>;

const initialInputs: Inputs = {
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

export function ScenarioCalculator() {
  const [inputs, setInputs] = useState<Inputs>(initialInputs);
  const result = useMemo(() => {
    const values = Object.fromEntries(fields.map(({ id }) => [id, parseValue(inputs[id])])) as Record<FieldId, number | null>;
    const complete = Object.values(values).every((value) => value !== null);
    const sale = values.sale;
    const successRate = values.successRate;

    if (!complete || sale === null || successRate === null || sale <= 0 || successRate <= 0 || successRate > 100) return null;

    const successfulDeliveryShare = successRate / 100;
    const profit = sale
      - (values.purchase ?? 0) * (1 + (values.additionalCost ?? 0) / 100)
      - (values.outboundDelivery ?? 0)
      - (values.acquiring ?? 0)
      - sale * (values.commission ?? 0) / 100
      - sale * (values.promotion ?? 0) / 100
      - ((1 - successfulDeliveryShare) / successfulDeliveryShare)
        * ((values.outboundDelivery ?? 0) + (values.returnDelivery ?? 0));

    return { profit, profitShare: profit / sale * 100 };
  }, [inputs]);

  const resultHint = useMemo(() => {
    if (Object.values(inputs).some((value) => value.trim() === "")) return "Заполни параметры расчёта.";
    if (Object.values(inputs).some((value) => parseValue(value) === null)) return "Проверь формат чисел в полях.";
    const sale = parseValue(inputs.sale);
    const successRate = parseValue(inputs.successRate);
    if (sale !== null && sale <= 0) return "Продажа должна быть больше нуля.";
    if (successRate !== null && (successRate <= 0 || successRate > 100)) return "Процент успешных доставок должен быть больше 0% и не выше 100%.";
    return "";
  }, [inputs]);

  return <>
    <PageHeader eyebrow="Отдельный расчёт" title="Номинальная прибыль" />
    <div className="scenario-layout">
      <section className="panel">
        <div className="panel-head">
          <div><h2>Параметры расчёта</h2></div>
          <Calculator size={17} color="#178b63" />
        </div>
        <div className="panel-body">
          <div className="form-grid">
            {fields.map(({ id, label }) => (
              <div className="field" key={id}>
                <label htmlFor={`scenario-${id}`}>{label}</label>
                <input
                  id={`scenario-${id}`}
                  type="text"
                  inputMode="decimal"
                  value={inputs[id]}
                  onChange={(event) => setInputs((current) => ({ ...current, [id]: event.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Итог к цене товара</h2>
          <TrendingUp size={17} color="#178b63" />
        </div>
        <div className="panel-body">
          <div className="scenario-result-grid">
            <div className="scenario-result">
              <span className="metric-label">Итог</span>
              <strong className="scenario-result-value" style={{ color: result && result.profit < 0 ? "var(--red)" : "var(--green-dark)" }}>
                {result ? rubles(result.profit) : "—"}
              </strong>
            </div>
            <div className="scenario-result">
              <span className="metric-label">Процент прибыли от дохода</span>
              <strong className="scenario-result-value" style={{ color: result && result.profitShare < 0 ? "var(--red)" : "var(--green-dark)" }}>
                {result ? percentage(result.profitShare) : "—"}
              </strong>
            </div>
          </div>
          {!result && resultHint && <p className="form-help">{resultHint}</p>}
        </div>
      </section>
    </div>
  </>;
}
