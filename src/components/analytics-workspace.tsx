"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Area, AreaChart, Bar, Brush, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { asRecord, requestJson } from "./api";

type TrendDay = { date: string; sentUnits: number; purchasedUnits: number };
type AnalyticsChartDay = TrendDay & {
  averageWindowDays?: number;
  averageSentUnits?: number;
  averagePurchasedUnits?: number;
  buyoutPercent: number | null;
  averageBuyoutPercent?: number | null;
};
type RatePoint = { date: string; timestamp: number; postingNumber: string; ratePercent: number };
type RateChartPoint = RatePoint & { averageRatePercent?: number; averageWindowDays?: number };
type CatalogProduct = { id: string; sku: string; title: string };
type ProductProfitDay = { date: string; productId: string; profitCents: number; units: number };
type AnalyticsData = { days: TrendDay[]; catalogProducts: CatalogProduct[]; productProfitDays: ProductProfitDay[]; ratePoints: RatePoint[]; availableFrom: string; availableTo: string };
type BrushRange = { startIndex: number; endIndex: number };
type BuyoutDay = AnalyticsChartDay;
type ChartSeries = { key: string; label: string; color: string; dashed?: boolean; bar?: boolean };

const countFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const averageCountFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const moneyFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const compactMoneyFormat = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 });
const buyoutPercentFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function dateLabel(value: string | number, month: "short" | "long" = "short") {
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month, timeZone: "Europe/Moscow" }).format(date);
}

function fullDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" })
    .format(new Date(`${value}T12:00:00Z`));
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function addDailySmoothing(days: TrendDay[], windowDays: number | null): AnalyticsChartDay[] {
  let windowSent = 0;
  let windowPurchased = 0;
  return days.map((day, index) => {
    windowSent += day.sentUnits;
    windowPurchased += day.purchasedUnits;
    if (windowDays && index >= windowDays) {
      windowSent -= days[index - windowDays].sentUnits;
      windowPurchased -= days[index - windowDays].purchasedUnits;
    }
    return {
      ...day,
      buyoutPercent: day.sentUnits > 0 ? day.purchasedUnits / day.sentUnits * 100 : null,
      averageWindowDays: windowDays ?? undefined,
      averageSentUnits: windowDays ? windowSent / Math.min(index + 1, windowDays) : undefined,
      averagePurchasedUnits: windowDays ? windowPurchased / Math.min(index + 1, windowDays) : undefined,
      averageBuyoutPercent: windowDays && windowSent > 0 ? windowPurchased / windowSent * 100 : null,
    };
  });
}

function addRateSmoothing(points: RatePoint[], days: TrendDay[], windowDays: number | null): RateChartPoint[] {
  if (!windowDays) return points;
  const dailyRates = new Map<string, { total: number; count: number }>();
  for (const point of points) {
    const current = dailyRates.get(point.date) ?? { total: 0, count: 0 };
    dailyRates.set(point.date, { total: current.total + point.ratePercent, count: current.count + 1 });
  }
  let windowTotal = 0;
  let activeDays = 0;
  const averageByDate = new Map<string, number>();
  for (const [index, day] of days.entries()) {
    const current = dailyRates.get(day.date);
    const previous = index >= windowDays ? dailyRates.get(days[index - windowDays].date) : undefined;
    if (current) { windowTotal += current.total / current.count; activeDays += 1; }
    if (previous) { windowTotal -= previous.total / previous.count; activeDays -= 1; }
    if (current && activeDays > 0) averageByDate.set(day.date, windowTotal / activeDays);
  }
  return points.map((point) => ({
    ...point,
    averageRatePercent: averageByDate.get(point.date),
    averageWindowDays: windowDays,
  }));
}

function moscowDayStart(date: string) {
  return new Date(`${date}T00:00:00+03:00`).getTime();
}

function parseAnalyticsData(value: unknown): AnalyticsData {
  const record = asRecord(value);
  const days = Array.isArray(record?.days) ? record.days.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.date !== "string") return [];
    return [{
      date: row.date,
      sentUnits: Number(row.sentUnits) || 0,
      purchasedUnits: Number(row.purchasedUnits) || 0,
    }];
  }) : [];
  const catalogProducts = Array.isArray(record?.catalogProducts) ? record.catalogProducts.flatMap((item) => {
    const row = asRecord(item);
    return row && typeof row.id === "string" && typeof row.sku === "string" && typeof row.title === "string"
      ? [{ id: row.id, sku: row.sku, title: row.title }]
      : [];
  }) : [];
  const productProfitDays = Array.isArray(record?.productProfitDays) ? record.productProfitDays.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.date !== "string" || typeof row.productId !== "string") return [];
    const profitCents = Number(row.profitCents);
    const units = Number(row.units);
    return Number.isFinite(profitCents) && Number.isFinite(units) && units > 0
      ? [{ date: row.date, productId: row.productId, profitCents, units }]
      : [];
  }) : [];
  const ratePoints = Array.isArray(record?.ratePoints) ? record.ratePoints.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.date !== "string" || typeof row.postingNumber !== "string") return [];
    const timestamp = Number(row.timestamp);
    const ratePercent = Number(row.ratePercent);
    return Number.isFinite(timestamp) && Number.isFinite(ratePercent)
      ? [{ date: row.date, timestamp, postingNumber: row.postingNumber, ratePercent }]
      : [];
  }) : [];
  return {
    days,
    catalogProducts,
    productProfitDays,
    ratePoints,
    availableFrom: typeof record?.availableFrom === "string" ? record.availableFrom : days[0]?.date ?? "",
    availableTo: typeof record?.availableTo === "string" ? record.availableTo : days.at(-1)?.date ?? "",
  };
}

function useChartTooltipTrigger() {
  const [trigger, setTrigger] = useState<"click" | "hover">("click");
  const touchMoved = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setTrigger(media.matches ? "hover" : "click");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return {
    trigger,
    onTouchStart: () => { touchMoved.current = false; setTrigger("hover"); },
    onTouchMove: () => { touchMoved.current = true; setTrigger("hover"); },
    onTouchEnd: () => { if (!touchMoved.current) setTrigger("click"); },
    onTouchCancel: () => { if (!touchMoved.current) setTrigger("click"); },
  };
}

function useSeriesVisibility() {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  return {
    hiddenKeys,
    isVisible: (key: string) => !hiddenKeys.includes(key),
    toggle: (key: string) => setHiddenKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]),
  };
}

function SeriesLegend({ items, hiddenKeys, onToggle }: { items: ChartSeries[]; hiddenKeys: string[]; onToggle: (key: string) => void }) {
  return <div className="analytics-series-legend">
    {items.map((item) => <button key={item.key} type="button" className="analytics-series-toggle" aria-pressed={!hiddenKeys.includes(item.key)} onClick={() => onToggle(item.key)}>
      <i className={`analytics-series-swatch${item.bar ? " bar" : ""}${item.dashed ? " dashed" : ""}`} style={{ color: item.color }} />
      <span>{item.label}</span>
    </button>)}
  </div>;
}

function UnitsTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as AnalyticsChartDay | undefined;
  if (!active || !day) return null;
  const visibleKeys = new Set((payload ?? []).map((entry) => String(entry.dataKey ?? "")));
  return <div className="analytics-tooltip">
    <strong>{fullDate(day.date)}</strong>
    {visibleKeys.has("sentUnits") && <span>Отправлено товаров <b>{countFormat.format(day.sentUnits)}</b></span>}
    {visibleKeys.has("purchasedUnits") && <span>Куплено товаров <b className="positive">{countFormat.format(day.purchasedUnits)}</b></span>}
    {day.averageWindowDays && visibleKeys.has("averageSentUnits") && <span>Среднее отправлений за {day.averageWindowDays} дн. <b>{averageCountFormat.format(day.averageSentUnits ?? 0)}</b></span>}
    {day.averageWindowDays && visibleKeys.has("averagePurchasedUnits") && <span>Среднее покупок за {day.averageWindowDays} дн. <b className="positive">{averageCountFormat.format(day.averagePurchasedUnits ?? 0)}</b></span>}
  </div>;
}

function RateTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as RateChartPoint | undefined;
  if (!active || !point) return null;
  const visibleKeys = new Set((payload ?? []).map((entry) => String(entry.dataKey ?? "")));
  return <div className="analytics-tooltip">
    <strong>{fullDate(point.date)}</strong>
    <span>Отправление <b>{point.postingNumber}</b></span>
    {visibleKeys.has("ratePercent") && <span>Добавочная стоимость <b>{percentFormat.format(point.ratePercent)}%</b></span>}
    {point.averageWindowDays && point.averageRatePercent !== undefined && visibleKeys.has("averageRatePercent") && <span>Среднее за {point.averageWindowDays} дн. <b>{percentFormat.format(point.averageRatePercent)}%</b></span>}
  </div>;
}

function UnitsChart({ days, smoothingDays }: { days: AnalyticsChartDay[]; smoothingDays: number | null }) {
  const tooltip = useChartTooltipTrigger();
  const series = useSeriesVisibility();
  const legendItems: ChartSeries[] = [
    { key: "sentUnits", label: "Отправлено товаров", color: "#dce9e2", bar: true },
    { key: "purchasedUnits", label: "Куплено товаров", color: "#16885f" },
    ...(smoothingDays ? [
      { key: "averageSentUnits", label: "Среднее отправлений", color: "#a5b9ad", dashed: true },
      { key: "averagePurchasedUnits", label: "Среднее покупок", color: "#16885f", dashed: true },
    ] : []),
  ];
  const totals = days.reduce((sum, day) => ({ sentUnits: sum.sentUnits + day.sentUnits, purchasedUnits: sum.purchasedUnits + day.purchasedUnits }), { sentUnits: 0, purchasedUnits: 0 });
  return <section className="panel analytics-chart-panel analytics-orders-panel">
    <div className="panel-head"><div><h2>Товары по дням</h2>{smoothingDays && <span className="small-note">Пунктир — среднее за {smoothingDays} дн.</span>}</div></div>
    <div className="panel-body analytics-chart-body">
      <div className="analytics-chart-total"><span>Отправлено товаров <b>{countFormat.format(totals.sentUnits)}</b></span><span>Куплено товаров <b className="positive">{countFormat.format(totals.purchasedUnits)}</b></span></div>
      <div className="analytics-chart-canvas" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 270 }}>
          <ComposedChart data={days} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis dataKey="date" tickFormatter={(date: string) => dateLabel(date)} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#dfe6e1" }} tickMargin={9} height={32} />
            <YAxis width={40} tickCount={5} allowDecimals={Boolean(smoothingDays)} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip trigger={tooltip.trigger} content={UnitsTooltip} cursor={{ fill: "rgba(22, 136, 95, .08)" }} isAnimationActive={false} />
            {series.isVisible("sentUnits") && <Bar dataKey="sentUnits" name="Отправлено товаров" fill="#dce9e2" maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
            {series.isVisible("purchasedUnits") && <Line dataKey="purchasedUnits" name="Куплено товаров" type="monotone" stroke="#16885f" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} isAnimationActive={false} />}
            {smoothingDays && <>
              {series.isVisible("averageSentUnits") && <Line dataKey="averageSentUnits" name={`Среднее отправлений · ${smoothingDays} дн.`} type="monotone" stroke="#a5b9ad" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
              {series.isVisible("averagePurchasedUnits") && <Line dataKey="averagePurchasedUnits" name={`Среднее покупок · ${smoothingDays} дн.`} type="monotone" stroke="#16885f" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
            </>}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <SeriesLegend items={legendItems} hiddenKeys={series.hiddenKeys} onToggle={series.toggle} />
    </div>
  </section>;
}

function BuyoutTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as BuyoutDay | undefined;
  if (!active || !day || (day.buyoutPercent === null && day.averageBuyoutPercent == null)) return null;
  const visibleKeys = new Set((payload ?? []).map((entry) => String(entry.dataKey ?? "")));
  return <div className="analytics-tooltip">
    <strong>{fullDate(day.date)}</strong>
    {day.buyoutPercent !== null && visibleKeys.has("buyoutPercent") && <>
      <span>Процент выкупа <b className="positive">{buyoutPercentFormat.format(day.buyoutPercent)}%</b></span>
      <span>Выкуплено <b>{countFormat.format(day.purchasedUnits)} из {countFormat.format(day.sentUnits)}</b></span>
    </>}
    {day.averageWindowDays && day.averageBuyoutPercent !== null && day.averageBuyoutPercent !== undefined && visibleKeys.has("averageBuyoutPercent") && <span>Среднее за {day.averageWindowDays} дн. <b className="positive">{buyoutPercentFormat.format(day.averageBuyoutPercent)}%</b></span>}
  </div>;
}

function BuyoutChart({ days, smoothingDays }: { days: AnalyticsChartDay[]; smoothingDays: number | null }) {
  const tooltip = useChartTooltipTrigger();
  const series = useSeriesVisibility();
  const legendItems: ChartSeries[] = [
    { key: "buyoutPercent", label: "Процент по дням", color: "#16885f" },
    ...(smoothingDays ? [{ key: "averageBuyoutPercent", label: `Среднее за ${smoothingDays} дней`, color: "#16885f", dashed: true }] : []),
  ];
  const totals = days.reduce((sum, day) => ({
    sentUnits: sum.sentUnits + day.sentUnits,
    purchasedUnits: sum.purchasedUnits + day.purchasedUnits,
  }), { sentUnits: 0, purchasedUnits: 0 });
  const buyoutPercent = totals.sentUnits > 0 ? totals.purchasedUnits / totals.sentUnits * 100 : null;
  return <section className="panel analytics-chart-panel analytics-buyout-panel">
    <div className="panel-head"><div><h2>Процент выкупа товаров</h2><span className="small-note">Выкуплено из всех отправленных · по дате заказа{smoothingDays ? ` · пунктир — среднее за ${smoothingDays} дн.` : ""}</span></div></div>
    <div className="panel-body analytics-chart-body">
      <div className="analytics-chart-total">
        <span>За период {buyoutPercent === null ? <b>—</b> : <b className="positive">{buyoutPercentFormat.format(buyoutPercent)}%</b>}</span>
        <span>Выкуплено <b>{countFormat.format(totals.purchasedUnits)}</b> из <b>{countFormat.format(totals.sentUnits)}</b> отправленных товаров</span>
      </div>
      {totals.sentUnits > 0 ? <div className="analytics-chart-canvas" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 270 }}>
          <LineChart data={days} margin={{ top: 10, right: 12, bottom: 4, left: -4 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis dataKey="date" tickFormatter={(date: string) => dateLabel(date)} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#dfe6e1" }} tickMargin={9} height={32} />
            <YAxis width={48} tickCount={5} domain={[0, 100]} tickFormatter={(value: number) => `${Math.round(value)}%`} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip trigger={tooltip.trigger} content={BuyoutTooltip} cursor={{ stroke: "rgba(22, 136, 95, .35)" }} isAnimationActive={false} />
            {series.isVisible("buyoutPercent") && <Line dataKey="buyoutPercent" name="Процент выкупа" type="monotone" stroke="#16885f" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} connectNulls isAnimationActive={false} />}
            {smoothingDays && series.isVisible("averageBuyoutPercent") && <Line dataKey="averageBuyoutPercent" name={`Среднее за ${smoothingDays} дн.`} type="monotone" stroke="#16885f" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, strokeWidth: 1 }} connectNulls isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="analytics-empty">За выбранный период нет отправленных товаров.</p>}
      <SeriesLegend items={legendItems} hiddenKeys={series.hiddenKeys} onToggle={series.toggle} />
    </div>
  </section>;
}

const productLineColors = ["#16885f", "#4978b8", "#c17d16", "#8a63b8", "#cf5d5d", "#168e9e", "#76604e"];

type ProductProfitChartDay = { date: string; unitsByProduct: Record<string, number>; averageUnitsByProduct: Record<string, number>; averageWindowDays?: number; [key: string]: unknown };

function ProductProfitTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as ProductProfitChartDay | undefined;
  if (!active || !day) return null;
  const rows = (payload ?? []).flatMap((entry) => {
    const profitPerUnit = Number(entry.value);
    const dataKey = String(entry.dataKey ?? "");
    const isAverage = dataKey.startsWith("average_profit_");
    const productId = dataKey.replace(/^(?:average_)?profit_/, "");
    const units = (isAverage ? day.averageUnitsByProduct : day.unitsByProduct)[productId] ?? 0;
    return Number.isFinite(profitPerUnit) && profitPerUnit > 0 && units > 0
      ? [{ productId, key: dataKey, title: String(entry.name ?? "Товар"), color: String(entry.color ?? "#16885f"), profitPerUnit, units, isAverage }]
      : [];
  });
  if (!rows.length) return null;
  return <div className="analytics-tooltip analytics-product-tooltip">
    <strong>{fullDate(day.date)}</strong>
    {rows.map((row) => <span key={row.key}>
      <i className="analytics-tooltip-dot" style={{ backgroundColor: row.color }} />
      <span className="analytics-product-tooltip-value">
        <span className="analytics-product-tooltip-title">{row.title}</span>
        <span className="analytics-product-tooltip-stats"><b className="positive">{moneyFormat.format(row.profitPerUnit)} ₽ / шт.</b><small>Продано {row.isAverage ? `за ${day.averageWindowDays} дн.` : "за день"}: {countFormat.format(row.units)} шт.</small></span>
      </span>
    </span>)}
  </div>;
}

function ProductProfitChart({ days, allDays, products, productProfitDays, smoothingDays }: { days: AnalyticsChartDay[]; allDays: AnalyticsChartDay[]; products: CatalogProduct[]; productProfitDays: ProductProfitDay[]; smoothingDays: number | null }) {
  const tooltip = useChartTooltipTrigger();
  const series = useSeriesVisibility();
  const legendItems: ChartSeries[] = products.flatMap((product, index) => {
    const color = productLineColors[index % productLineColors.length];
    return [
      { key: `profit_${product.id}`, label: `${product.title} · день`, color },
      ...(smoothingDays ? [{ key: `average_profit_${product.id}`, label: `${product.title} · среднее`, color, dashed: true }] : []),
    ];
  });
  const pointByProductDay = useMemo(() => new Map(productProfitDays.map((point) => [`${point.date}\u0000${point.productId}`, point])), [productProfitDays]);
  const allChartDays = useMemo(() => allDays.map((day, dayIndex) => {
    const unitsByProduct: Record<string, number> = {};
    const averageUnitsByProduct: Record<string, number> = {};
    const chartDay: ProductProfitChartDay = { date: day.date, unitsByProduct, averageUnitsByProduct, averageWindowDays: smoothingDays ?? undefined };
    for (const product of products) {
      const point = pointByProductDay.get(`${day.date}\u0000${product.id}`);
      chartDay[`profit_${product.id}`] = point && point.profitCents > 0 && point.units > 0 ? point.profitCents / point.units / 100 : null;
      unitsByProduct[product.id] = point?.units ?? 0;
      if (smoothingDays) {
        let profitCents = 0;
        let units = 0;
        const firstWindowDay = Math.max(0, dayIndex - smoothingDays + 1);
        for (let index = firstWindowDay; index <= dayIndex; index += 1) {
          const windowPoint = pointByProductDay.get(`${allDays[index].date}\u0000${product.id}`);
          if (windowPoint && windowPoint.profitCents > 0 && windowPoint.units > 0) {
            profitCents += windowPoint.profitCents;
            units += windowPoint.units;
          }
        }
        chartDay[`average_profit_${product.id}`] = units > 0 ? profitCents / units / 100 : null;
        averageUnitsByProduct[product.id] = units;
      }
    }
    return chartDay;
  }), [allDays, pointByProductDay, products, smoothingDays]);
  const visibleDates = useMemo(() => new Set(days.map((day) => day.date)), [days]);
  const chartDays = useMemo(() => allChartDays.filter((day) => visibleDates.has(day.date)), [allChartDays, visibleDates]);
  const hasVisibleData = chartDays.some((day) => products.some((product) =>
    Number(day[`profit_${product.id}`]) > 0 || Number(day[`average_profit_${product.id}`]) > 0,
  ));

  return <section className="panel analytics-chart-panel analytics-product-profit-panel">
    <div className="panel-head"><div><h2>Прибыль с проданного товара</h2><span className="small-note">Рубли с одной штуки · дата доставки или выкупа{smoothingDays ? ` · пунктир — среднее за ${smoothingDays} дн.` : ""}</span></div></div>
    <div className="panel-body analytics-chart-body">
      <p className="analytics-profit-chart-note">Начисления Ozon минус закупка и добавочная стоимость на дату продажи. Показана положительная прибыль по невозвращённым товарам.</p>
      <SeriesLegend items={legendItems} hiddenKeys={series.hiddenKeys} onToggle={series.toggle} />
      {hasVisibleData ? <div className="analytics-chart-canvas" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 300 }}>
          <LineChart data={chartDays} margin={{ top: 10, right: 12, bottom: 4, left: -4 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis dataKey="date" tickFormatter={(date: string) => dateLabel(date)} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#dfe6e1" }} tickMargin={9} height={32} />
            <YAxis width={56} tickCount={5} domain={[0, "auto"]} tickFormatter={(value: number) => `${compactMoneyFormat.format(value)} ₽`} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={false} />
            <ReferenceLine y={0} stroke="#8e9992" strokeWidth={1.5} />
            <Tooltip trigger={tooltip.trigger} content={ProductProfitTooltip} cursor={{ stroke: "rgba(22, 136, 95, .35)" }} isAnimationActive={false} />
            {products.map((product) => {
              const index = products.findIndex((candidate) => candidate.id === product.id);
              const color = productLineColors[index % productLineColors.length];
              return <Fragment key={product.id}>
                {series.isVisible(`profit_${product.id}`) && <Line dataKey={`profit_${product.id}`} name={`${product.title} · ${product.sku}`} type="monotone" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />}
                {smoothingDays && series.isVisible(`average_profit_${product.id}`) && <Line dataKey={`average_profit_${product.id}`} name={`${product.title} · ${product.sku} · среднее`} type="monotone" stroke={color} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, strokeWidth: 1 }} connectNulls={false} isAnimationActive={false} />}
              </Fragment>;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="analytics-empty">За выбранный период нет продаж с положительной прибылью.</p>}
    </div>
  </section>;
}

function RateChart({ points, days, smoothingDays }: { points: RateChartPoint[]; days: AnalyticsChartDay[]; smoothingDays: number | null }) {
  const tooltip = useChartTooltipTrigger();
  const series = useSeriesVisibility();
  const legendItems: ChartSeries[] = [
    { key: "ratePercent", label: "По заказам", color: "#16885f" },
    ...(smoothingDays ? [{ key: "averageRatePercent", label: `Среднее за ${smoothingDays} дней`, color: "#16885f", dashed: true }] : []),
  ];
  const firstDay = days[0]?.date;
  const lastDay = days.at(-1)?.date;
  const domain: [number, number] = firstDay && lastDay
    ? [moscowDayStart(firstDay), moscowDayStart(lastDay) + 86_400_000]
    : [0, 1];
  return <section className="panel analytics-chart-panel analytics-added-cost-panel">
    <div className="panel-head"><div><h2>Добавочная стоимость</h2>{smoothingDays && <span className="small-note">Пунктир — среднее дневных значений за {smoothingDays} дн.</span>}</div></div>
    <div className="panel-body analytics-chart-body">
      <div className="analytics-chart-total">Процент, сохранённый для каждого заказа</div>
      {points.length ? <div className="analytics-chart-canvas" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 440, height: 270 }}>
          <LineChart data={points} margin={{ top: 10, right: 12, bottom: 4, left: -4 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis type="number" dataKey="timestamp" scale="time" domain={domain} tickFormatter={(timestamp: number) => dateLabel(timestamp)} tickCount={5} minTickGap={18} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#dfe6e1" }} tickMargin={9} height={32} />
            <YAxis width={54} tickCount={5} tickFormatter={(value: number) => `${percentFormat.format(value)}%`} domain={["auto", "auto"]} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={false} />
            <ReferenceLine y={0} stroke="#8e9992" strokeWidth={1.5} />
            <Tooltip trigger={tooltip.trigger} content={RateTooltip} cursor={{ stroke: "rgba(22, 136, 95, .35)" }} isAnimationActive={false} />
            {series.isVisible("ratePercent") && <Line dataKey="ratePercent" name="Добавочная стоимость" type="stepAfter" stroke="#16885f" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 6, strokeWidth: 2 }} isAnimationActive={false} />}
            {smoothingDays && series.isVisible("averageRatePercent") && <Line dataKey="averageRatePercent" name={`Среднее · ${smoothingDays} дн.`} type="monotone" stroke="#16885f" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, strokeWidth: 1 }} connectNulls isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="analytics-empty">За выбранный период нет заказов с рассчитанным процентом.</p>}
      <SeriesLegend items={legendItems} hiddenKeys={series.hiddenKeys} onToggle={series.toggle} />
    </div>
  </section>;
}

export function AnalyticsWorkspace() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [smoothingDays, setSmoothingDays] = useState<number | null>(null);
  const [brushRange, setBrushRange] = useState<BrushRange>({ startIndex: 0, endIndex: 0 });
  const [retryAttempt, setRetryAttempt] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = parseAnalyticsData(await requestJson("/api/analytics", { signal }));
      setData(result);
      if (!signal.aborted) {
        const defaultFrom = result.availableTo && result.availableFrom
          ? (shiftDate(result.availableTo, -29) < result.availableFrom ? result.availableFrom : shiftDate(result.availableTo, -29))
          : "";
        setDateFrom(defaultFrom);
        setDateTo(result.availableTo);
        setBrushRange({ startIndex: 0, endIndex: Math.max(0, result.days.length - 1) });
      }
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить графики.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, retryAttempt]);

  const allChartDays = useMemo(() => addDailySmoothing(data?.days ?? [], smoothingDays), [data?.days, smoothingDays]);
  const rangeDays = useMemo(() => allChartDays.filter((day) => day.date >= dateFrom && day.date <= dateTo), [allChartDays, dateFrom, dateTo]);
  useEffect(() => setBrushRange({ startIndex: 0, endIndex: Math.max(0, rangeDays.length - 1) }), [dateFrom, dateTo, rangeDays.length]);
  const lastIndex = Math.max(0, rangeDays.length - 1);
  const startIndex = Math.min(brushRange.startIndex, lastIndex);
  const endIndex = Math.max(startIndex, Math.min(brushRange.endIndex, lastIndex));
  const visibleDays = rangeDays.slice(startIndex, endIndex + 1);
  const visibleDates = useMemo(() => new Set(visibleDays.map((day) => day.date)), [visibleDays]);
  const allRatePoints = useMemo(() => addRateSmoothing(data?.ratePoints ?? [], data?.days ?? [], smoothingDays), [data?.days, data?.ratePoints, smoothingDays]);
  const visibleRates = useMemo(() => allRatePoints.filter((point) => visibleDates.has(point.date)), [allRatePoints, visibleDates]);
  const canChooseDates = Boolean(data?.availableFrom && data.availableTo);
  const isZoomed = startIndex > 0 || endIndex < lastIndex;

  function choosePreset(dayCount: number | null) {
    if (!data?.availableFrom || !data.availableTo) return;
    const from = dayCount === null ? data.availableFrom : shiftDate(data.availableTo, -(dayCount - 1));
    setDateFrom(from < data.availableFrom ? data.availableFrom : from);
    setDateTo(data.availableTo);
  }

  function updateBrush(next: BrushRange | null) {
    if (!next || typeof next.startIndex !== "number" || typeof next.endIndex !== "number") return;
    setBrushRange({ startIndex: next.startIndex, endIndex: next.endIndex });
  }

  return <>
    <header className="page-heading">
      <div><div className="eyebrow">Аналитика</div><h1>Графики</h1><p className="page-description">Продажи, прибыль с одной штуки, добавочная стоимость и процент выкупа за выбранный период.</p></div>
    </header>

    <section className="panel analytics-period-panel">
      <div className="panel-head"><h2>Период и масштаб</h2>{loading && <span className="small-note analytics-loading"><LoaderCircle size={14} aria-hidden="true" />Загружаю данные</span>}</div>
      <div className="panel-body analytics-period-body">
        <div className="analytics-period-controls">
          <div className="analytics-presets" aria-label="Быстрый выбор периода">
            <button type="button" className="button secondary small" disabled={!canChooseDates} onClick={() => choosePreset(30)}>30 дней</button>
            <button type="button" className="button secondary small" disabled={!canChooseDates} onClick={() => choosePreset(90)}>90 дней</button>
            <button type="button" className="button secondary small" disabled={!canChooseDates} onClick={() => choosePreset(365)}>12 месяцев</button>
            <button type="button" className="button secondary small" disabled={!canChooseDates} onClick={() => choosePreset(null)}>Всё время</button>
          </div>
          <div className="analytics-date-fields">
            <label>С <input aria-label="Начало периода" type="date" min={data?.availableFrom} max={dateTo || data?.availableTo} value={dateFrom} disabled={!canChooseDates} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label>По <input aria-label="Конец периода" type="date" min={dateFrom || data?.availableFrom} max={data?.availableTo} value={dateTo} disabled={!canChooseDates} onChange={(event) => setDateTo(event.target.value)} /></label>
            <label>Сглаживание <select aria-label="Сглаживание графиков" value={smoothingDays ?? ""} onChange={(event) => setSmoothingDays(event.target.value ? Number(event.target.value) : null)}><option value="">Выкл.</option><option value="7">7 дней</option><option value="14">14 дней</option><option value="30">30 дней</option></select></label>
            {isZoomed && <button type="button" className="button secondary small analytics-reset-zoom" onClick={() => setBrushRange({ startIndex: 0, endIndex: lastIndex })}>Сбросить масштаб</button>}
          </div>
        </div>
        {rangeDays.length > 1 && <>
          <p className="analytics-brush-hint">Перетащи края шкалы, чтобы приблизить все графики к нужным датам.</p>
          <div className="analytics-brush-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 88 }}>
              <AreaChart data={rangeDays} margin={{ top: 2, right: 12, bottom: 0, left: 12 }}>
                <Area dataKey="sentUnits" stroke="#16885f" fill="#dcefe5" strokeWidth={1.5} isAnimationActive={false} />
                <Brush dataKey="date" startIndex={startIndex} endIndex={endIndex} onChange={updateBrush} height={48} travellerWidth={16} stroke="#16885f" fill="#f4f8f5" tickFormatter={(date: string) => dateLabel(date)}>
                  <AreaChart data={rangeDays}>
                    <Area dataKey="sentUnits" stroke="#16885f" fill="#cfe6d9" isAnimationActive={false} />
                  </AreaChart>
                </Brush>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>}
        {error && <div className="analytics-error" role="alert">{error} <button type="button" className="button secondary small" onClick={() => setRetryAttempt((current) => current + 1)}>Повторить</button></div>}
      </div>
    </section>

    {!error && data && <div className="analytics-charts-grid">
      <UnitsChart days={visibleDays} smoothingDays={smoothingDays} />
      <ProductProfitChart days={visibleDays} allDays={allChartDays} products={data.catalogProducts} productProfitDays={data.productProfitDays} smoothingDays={smoothingDays} />
      <RateChart points={visibleRates} days={visibleDays} smoothingDays={smoothingDays} />
      <BuyoutChart days={visibleDays} smoothingDays={smoothingDays} />
    </div>}
  </>;
}
