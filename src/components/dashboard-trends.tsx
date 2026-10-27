"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

export type DailyTrendDay = {
  date: string;
  orders: number;
  deliveredOrders: number;
  profitCents: number;
  incompleteProfitCount: number;
};

const countFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const compactRubles = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

function useChartTooltipTrigger() {
  const [trigger, setTrigger] = useState<"click" | "hover">("click");
  const touchMoved = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateTrigger = () => setTrigger(media.matches ? "hover" : "click");
    updateTrigger();
    media.addEventListener("change", updateTrigger);
    return () => media.removeEventListener("change", updateTrigger);
  }, []);

  return {
    trigger,
    onTouchStart: () => {
      touchMoved.current = false;
      setTrigger("hover");
    },
    onTouchMove: () => {
      touchMoved.current = true;
      setTrigger("hover");
    },
    onTouchEnd: () => {
      if (!touchMoved.current) setTrigger("click");
    },
    onTouchCancel: () => {
      if (!touchMoved.current) setTrigger("click");
    },
  };
}

function chartDate(date: string, month: "short" | "long" = "short") {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month, timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

function fullDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

function formatProfit(cents: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(cents / 100)} ₽`;
}

function formatAxisRubles(rubles: number) {
  return `${compactRubles.format(rubles)} ₽`;
}

function SalesTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as DailyTrendDay | undefined;
  if (!active || !day) return null;

  return <div className="dashboard-chart-tooltip">
    <strong className="dashboard-chart-tooltip-date">{fullDate(day.date)}</strong>
    <div className="dashboard-chart-tooltip-row"><span>Заказов</span><b>{countFormat.format(day.orders)}</b></div>
    <div className="dashboard-chart-tooltip-row"><span>Доставлено</span><b className="positive">{countFormat.format(day.deliveredOrders)}</b></div>
  </div>;
}

function ProfitTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as DailyTrendDay | undefined;
  if (!active || !day) return null;

  const value = day.profitCents;
  const label = value > 0 ? "Прибыль" : value < 0 ? "Убыток" : "Результат";
  const color = value < 0 ? "negative" : "positive";
  const amount = `${value < 0 ? "−" : value > 0 ? "+" : ""}${formatProfit(Math.abs(value))}`;

  return <div className="dashboard-chart-tooltip">
    <strong className="dashboard-chart-tooltip-date">{fullDate(day.date)}</strong>
    <div className="dashboard-chart-tooltip-row"><span>{label}</span><b className={color}>{amount}</b></div>
    {day.incompleteProfitCount > 0 && <div className="dashboard-chart-tooltip-note">Без себестоимости: {day.incompleteProfitCount}</div>}
  </div>;
}

function SalesChart({ days }: { days: DailyTrendDay[] }) {
  const tooltip = useChartTooltipTrigger();
  const totals = days.reduce((total, day) => ({
    orders: total.orders + day.orders,
    deliveredOrders: total.deliveredOrders + day.deliveredOrders,
  }), { orders: 0, deliveredOrders: 0 });

  return <section className="panel dashboard-trend-panel">
    <div className="panel-head"><div><h2>Продажи по дням</h2><span className="small-note">Последние 30 дней</span></div></div>
    <div className="panel-body dashboard-trend-body">
      <div className="dashboard-trend-totals">
        <span>Заказов: <strong>{countFormat.format(totals.orders)}</strong></span>
        <span>Доставлено: <strong>{countFormat.format(totals.deliveredOrders)}</strong></span>
      </div>
      <div className="dashboard-trend-chart" role="group" aria-label="Заказы и доставки по дням оформления" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 230 }}>
          <ComposedChart data={days} margin={{ top: 10, right: 12, bottom: 4, left: -16 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) => chartDate(date)}
              interval="preserveStartEnd"
              minTickGap={16}
              tick={{ fill: "#839088", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#dfe6e1" }}
              tickMargin={9}
              height={32}
            />
            <YAxis
              width={38}
              tickCount={4}
              allowDecimals={false}
              tick={{ fill: "#839088", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip trigger={tooltip.trigger} content={SalesTooltip} cursor={{ fill: "rgba(22, 136, 95, .08)" }} isAnimationActive={false} />
            <Bar dataKey="orders" name="Заказов" fill="#dce9e2" maxBarSize={20} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line dataKey="deliveredOrders" name="Доставлено" type="monotone" stroke="#16885f" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="dashboard-trend-legend">
        <span><i className="dashboard-trend-legend-swatch muted" />Заказы</span>
        <span><i className="dashboard-trend-legend-swatch success" />Доставлено</span>
      </div>
    </div>
  </section>;
}

function ProfitChart({ days, incompleteCount }: { days: DailyTrendDay[]; incompleteCount: number }) {
  const tooltip = useChartTooltipTrigger();
  const chartDays = days.map((day) => ({ ...day, profitRubles: day.profitCents / 100 }));
  const totalProfit = days.reduce((total, day) => total + day.profitCents, 0);

  return <section className="panel dashboard-trend-panel">
    <div className="panel-head"><div><h2>Прибыль по товарам</h2><span className="small-note">Последние 30 дней</span></div></div>
    <div className="panel-body dashboard-trend-body">
      <div className="dashboard-trend-totals">
        <span>За 30 дней: <strong className={totalProfit < 0 ? "negative" : "positive"}>{formatProfit(totalProfit)}</strong></span>
      </div>
      <div className="dashboard-trend-chart" role="group" aria-label="Прибыль и убыток по дням" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 230 }}>
          <BarChart data={chartDays} margin={{ top: 10, right: 12, bottom: 4, left: -4 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) => chartDate(date)}
              interval="preserveStartEnd"
              minTickGap={16}
              tick={{ fill: "#839088", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#dfe6e1" }}
              tickMargin={9}
              height={32}
            />
            <YAxis
              width={48}
              tickCount={5}
              tickFormatter={formatAxisRubles}
              tick={{ fill: "#839088", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine y={0} stroke="#8e9992" strokeWidth={1.5} />
            <Tooltip trigger={tooltip.trigger} content={ProfitTooltip} cursor={{ fill: "rgba(22, 136, 95, .08)" }} isAnimationActive={false} />
            <Bar dataKey="profitRubles" name="Результат" maxBarSize={20} radius={[3, 3, 3, 3]} isAnimationActive={false}>
              {chartDays.map((day) => <Cell key={day.date} fill={day.profitCents < 0 ? "#d96565" : "#2d9a70"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="dashboard-trend-legend">
        <span><i className="dashboard-trend-legend-swatch success" />Прибыль</span>
        <span><i className="dashboard-trend-legend-swatch negative" />Убыток</span>
      </div>
      {incompleteCount > 0 && <p className="small-note dashboard-trend-note">Без полной себестоимости: {incompleteCount} отправлений.</p>}
    </div>
  </section>;
}

export function DashboardTrends({ days, incompleteProfitCount }: { days: DailyTrendDay[]; incompleteProfitCount: number }) {
  return <div className="dashboard-trends-grid">
    <SalesChart days={days} />
    <ProfitChart days={days} incompleteCount={incompleteProfitCount} />
  </div>;
}
