"use client";

import { useMemo, useState } from "react";
import { Calculator, CircleHelp, TrendingUp } from "lucide-react";
import { PageHeader } from "./page-header";

const rubles = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);

export function ScenarioCalculator() {
  const [price, setPrice] = useState("0");
  const [cost, setCost] = useState("0");
  const [commissionPercent, setCommissionPercent] = useState("0");
  const [logistics, setLogistics] = useState("0");
  const [extraCost, setExtraCost] = useState("0");
  const [quantity, setQuantity] = useState("1");
  const result = useMemo(() => {
    const sale = Number(price) || 0; const unitCost = Number(cost) || 0; const commission = Number(commissionPercent) || 0;
    const deductions = sale * commission / 100 + (Number(logistics) || 0) + (Number(extraCost) || 0);
    const unitProfit = sale - unitCost - deductions;
    const count = Number(quantity) || 0;
    return { deductions, unitProfit, total: unitProfit * count, margin: sale ? unitProfit / sale * 100 : 0, count };
  }, [price, cost, commissionPercent, logistics, extraCost, quantity]);

  return <>
    <PageHeader eyebrow="Отдельный расчёт" title="Номинальная прибыль" description="Оцените возможный результат продажи до учёта фактических операций. Калькулятор не меняет остатки, денежный баланс или подтверждённую прибыль." />
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-head"><div><h2>Параметры сценария</h2><span className="small-note">Измените входные данные для оценки</span></div><Calculator size={17} color="#178b63" /></div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field"><label htmlFor="scenario-price">Цена продажи, ₽</label><input id="scenario-price" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></div>
            <div className="field"><label htmlFor="scenario-cost">Полная себестоимость, ₽</label><input id="scenario-cost" type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} /></div>
            <div className="field"><label htmlFor="scenario-commission">Комиссия Ozon, %</label><input id="scenario-commission" type="number" min="0" max="100" step="0.1" value={commissionPercent} onChange={(event) => setCommissionPercent(event.target.value)} /></div>
            <div className="field"><label htmlFor="scenario-logistics">Логистика и эквайринг, ₽</label><input id="scenario-logistics" type="number" min="0" step="0.01" value={logistics} onChange={(event) => setLogistics(event.target.value)} /></div>
            <div className="field"><label htmlFor="scenario-extra">Другие удержания, ₽</label><input id="scenario-extra" type="number" min="0" step="0.01" value={extraCost} onChange={(event) => setExtraCost(event.target.value)} /></div>
            <div className="field"><label htmlFor="scenario-quantity">Количество, шт.</label><input id="scenario-quantity" type="number" min="0" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
          </div>
        </div>
      </section>
      <div className="dashboard-column">
        <section className="panel">
          <div className="panel-head"><div><h2>Результат оценки</h2><span className="small-note">Расчёт по введённым параметрам</span></div><TrendingUp size={17} color="#178b63" /></div>
          <div className="panel-body mini-stat-list">
            <div className="mini-stat"><span className="mini-stat-label">Удержания на единицу</span><span className="mini-stat-value">{rubles(result.deductions)}</span></div>
            <div className="mini-stat"><span className="mini-stat-label">Номинально на единицу</span><span className="mini-stat-value" style={{ color: result.unitProfit < 0 ? "var(--red)" : "var(--green-dark)" }}>{rubles(result.unitProfit)}</span></div>
            <div className="mini-stat"><span className="mini-stat-label">Маржинальность</span><span className="mini-stat-value">{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(result.margin)}%</span></div>
            <div style={{ padding: "16px 0 5px" }}><div className="metric-label">Оценка для {result.count} шт.</div><div className="metric-value" style={{ fontSize: 28, color: result.total < 0 ? "var(--red)" : "var(--green-dark)" }}>{rubles(result.total)}</div></div>
          </div>
        </section>
        <div className="notice"><CircleHelp size={15} /><span>Это предварительная оценка. Для фактической прибыли сервис использует реальные начисления и удержания Ozon по операциям, а также полную себестоимость товара.</span></div>
      </div>
    </div>
  </>;
}
