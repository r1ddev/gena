"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Area, AreaChart, Bar, Brush, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { asRecord, requestJson } from "./api";

type TrendDay = { date: string; sentUnits: number; purchasedUnits: number };
type RatePoint = { date: string; timestamp: number; postingNumber: string; ratePercent: number };
type CatalogProduct = { id: string; sku: string; title: string };
type ProductProfitDay = { date: string; productId: string; profitCents: number; units: number };
type AnalyticsData = { days: TrendDay[]; catalogProducts: CatalogProduct[]; productProfitDays: ProductProfitDay[]; ratePoints: RatePoint[]; availableFrom: string; availableTo: string };
type BrushRange = { startIndex: number; endIndex: number };
type BuyoutDay = TrendDay & { buyoutPercent: number | null };

const countFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
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

function UnitsTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as TrendDay | undefined;
  if (!active || !day) return null;
  return <div className="analytics-tooltip">
    <strong>{fullDate(day.date)}</strong>
    <span>Отправлено товаров <b>{countFormat.format(day.sentUnits)}</b></span>
    <span>Куплено товаров <b className="positive">{countFormat.format(day.purchasedUnits)}</b></span>
  </div>;
}

function RateTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as RatePoint | undefined;
  if (!active || !point) return null;
  return <div className="analytics-tooltip">
    <strong>{fullDate(point.date)}</strong>
    <span>Отправление <b>{point.postingNumber}</b></span>
    <span>Добавочная стоимость <b>{percentFormat.format(point.ratePercent)}%</b></span>
  </div>;
}

function UnitsChart({ days }: { days: TrendDay[] }) {
  const tooltip = useChartTooltipTrigger();
  const totals = days.reduce((sum, day) => ({ sentUnits: sum.sentUnits + day.sentUnits, purchasedUnits: sum.purchasedUnits + day.purchasedUnits }), { sentUnits: 0, purchasedUnits: 0 });
  return <section className="panel analytics-chart-panel analytics-orders-panel">
    <div className="panel-head"><h2>Товары по дням</h2></div>
    <div className="panel-body analytics-chart-body">
      <div className="analytics-chart-total"><span>Отправлено товаров <b>{countFormat.format(totals.sentUnits)}</b></span><span>Куплено товаров <b className="positive">{countFormat.format(totals.purchasedUnits)}</b></span></div>
      <div className="analytics-chart-canvas" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 270 }}>
          <ComposedChart data={days} margin={{ top: 10, right: 12, bottom: 4, left: -10 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis dataKey="date" tickFormatter={(date: string) => dateLabel(date)} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#dfe6e1" }} tickMargin={9} height={32} />
            <YAxis width={40} tickCount={5} allowDecimals={false} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip trigger={tooltip.trigger} content={UnitsTooltip} cursor={{ fill: "rgba(22, 136, 95, .08)" }} isAnimationActive={false} />
            <Bar dataKey="sentUnits" name="Отправлено товаров" fill="#dce9e2" maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line dataKey="purchasedUnits" name="Куплено товаров" type="monotone" stroke="#16885f" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="analytics-legend"><span><i className="orders" />Отправлено товаров</span><span><i className="delivered" />Куплено товаров</span></div>
    </div>
  </section>;
}

function BuyoutTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as BuyoutDay | undefined;
  if (!active || !day || day.buyoutPercent === null) return null;
  return <div className="analytics-tooltip">
    <strong>{fullDate(day.date)}</strong>
    <span>Процент выкупа <b className="positive">{buyoutPercentFormat.format(day.buyoutPercent)}%</b></span>
    <span>Выкуплено <b>{countFormat.format(day.purchasedUnits)} из {countFormat.format(day.sentUnits)}</b></span>
  </div>;
}

function BuyoutChart({ days }: { days: TrendDay[] }) {
  const tooltip = useChartTooltipTrigger();
  const totals = days.reduce((sum, day) => ({
    sentUnits: sum.sentUnits + day.sentUnits,
    purchasedUnits: sum.purchasedUnits + day.purchasedUnits,
  }), { sentUnits: 0, purchasedUnits: 0 });
  const buyoutPercent = totals.sentUnits > 0 ? totals.purchasedUnits / totals.sentUnits * 100 : null;
  const chartDays: BuyoutDay[] = days.map((day) => ({
    ...day,
    buyoutPercent: day.sentUnits > 0 ? day.purchasedUnits / day.sentUnits * 100 : null,
  }));

  return <section className="panel analytics-chart-panel analytics-buyout-panel">
    <div className="panel-head"><div><h2>Процент выкупа товаров</h2><span className="small-note">Выкуплено из всех отправленных · по дате заказа</span></div></div>
    <div className="panel-body analytics-chart-body">
      <div className="analytics-chart-total">
        <span>За период {buyoutPercent === null ? <b>—</b> : <b className="positive">{buyoutPercentFormat.format(buyoutPercent)}%</b>}</span>
        <span>Выкуплено <b>{countFormat.format(totals.purchasedUnits)}</b> из <b>{countFormat.format(totals.sentUnits)}</b> отправленных товаров</span>
      </div>
      {totals.sentUnits > 0 ? <div className="analytics-chart-canvas" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 270 }}>
          <LineChart data={chartDays} margin={{ top: 10, right: 12, bottom: 4, left: -4 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis dataKey="date" tickFormatter={(date: string) => dateLabel(date)} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#dfe6e1" }} tickMargin={9} height={32} />
            <YAxis width={48} tickCount={5} domain={[0, 100]} tickFormatter={(value: number) => `${Math.round(value)}%`} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip trigger={tooltip.trigger} content={BuyoutTooltip} cursor={{ stroke: "rgba(22, 136, 95, .35)" }} isAnimationActive={false} />
            <Line dataKey="buyoutPercent" name="Процент выкупа" type="monotone" stroke="#16885f" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="analytics-empty">За выбранный период нет отправленных товаров.</p>}
    </div>
  </section>;
}

const productLineColors = ["#16885f", "#4978b8", "#c17d16", "#8a63b8", "#cf5d5d", "#168e9e", "#76604e"];

type ProductProfitChartDay = { date: string; unitsByProduct: Record<string, number>; [key: string]: unknown };

function ProductProfitTooltip({ active, payload }: TooltipContentProps) {
  const day = payload?.[0]?.payload as ProductProfitChartDay | undefined;
  if (!active || !day) return null;
  const rows = (payload ?? []).flatMap((entry) => {
    const profitPerUnit = Number(entry.value);
    const productId = String(entry.dataKey ?? "").replace(/^profit_/, "");
    const units = day.unitsByProduct[productId] ?? 0;
    return Number.isFinite(profitPerUnit) && profitPerUnit > 0 && units > 0
      ? [{ productId, title: String(entry.name ?? "Товар"), color: String(entry.color ?? "#16885f"), profitPerUnit, units }]
      : [];
  });
  if (!rows.length) return null;
  return <div className="analytics-tooltip analytics-product-tooltip">
    <strong>{fullDate(day.date)}</strong>
    {rows.map((row) => <span key={row.productId}>
      <i className="analytics-tooltip-dot" style={{ backgroundColor: row.color }} />
      <span className="analytics-product-tooltip-value">{row.title}<b className="positive">{moneyFormat.format(row.profitPerUnit)} ₽ / шт.</b><small>Продано: {countFormat.format(row.units)} шт.</small></span>
    </span>)}
  </div>;
}

function ProductProfitChart({ days, products, productProfitDays }: { days: TrendDay[]; products: CatalogProduct[]; productProfitDays: ProductProfitDay[] }) {
  const tooltip = useChartTooltipTrigger();
  const [hiddenProducts, setHiddenProducts] = useState<string[]>([]);
  const visibleProducts = products.filter((product) => !hiddenProducts.includes(product.id));
  const pointByProductDay = useMemo(() => new Map(productProfitDays.map((point) => [`${point.date}\u0000${point.productId}`, point])), [productProfitDays]);
  const chartDays = useMemo(() => days.map((day) => {
    const unitsByProduct: Record<string, number> = {};
    const chartDay: ProductProfitChartDay = { date: day.date, unitsByProduct };
    for (const product of products) {
      const point = pointByProductDay.get(`${day.date}\u0000${product.id}`);
      chartDay[`profit_${product.id}`] = point && point.profitCents > 0 && point.units > 0 ? point.profitCents / point.units / 100 : null;
      unitsByProduct[product.id] = point?.units ?? 0;
    }
    return chartDay;
  }), [days, pointByProductDay, products]);
  const hasVisibleData = chartDays.some((day) => visibleProducts.some((product) => Number(day[`profit_${product.id}`]) > 0));

  function toggleProduct(productId: string) {
    setHiddenProducts((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  return <section className="panel analytics-chart-panel analytics-product-profit-panel">
    <div className="panel-head"><div><h2>Прибыль с проданного товара</h2><span className="small-note">Рубли с одной штуки · дата доставки или выкупа</span></div></div>
    <div className="panel-body analytics-chart-body">
      <p className="analytics-profit-chart-note">Начисления Ozon минус закупка и добавочная стоимость на дату продажи. Показана положительная прибыль по невозвращённым товарам.</p>
      <div className="analytics-product-legend" aria-label="Показывать товары на графике">
        {products.map((product, index) => {
          const selected = !hiddenProducts.includes(product.id);
          return <button key={product.id} type="button" className="analytics-product-toggle" aria-label={`${product.title}, артикул ${product.sku}`} title={`${product.title} · ${product.sku}`} aria-pressed={selected} onClick={() => toggleProduct(product.id)}>
            <i style={{ backgroundColor: selected ? productLineColors[index % productLineColors.length] : "#b9c2bd" }} />
            <span>{product.title}</span>
          </button>;
        })}
      </div>
      {hasVisibleData ? <div className="analytics-chart-canvas" onTouchStart={tooltip.onTouchStart} onTouchMove={tooltip.onTouchMove} onTouchEnd={tooltip.onTouchEnd} onTouchCancel={tooltip.onTouchCancel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 300 }}>
          <LineChart data={chartDays} margin={{ top: 10, right: 12, bottom: 4, left: -4 }}>
            <CartesianGrid vertical={false} stroke="#e8ede9" />
            <XAxis dataKey="date" tickFormatter={(date: string) => dateLabel(date)} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#dfe6e1" }} tickMargin={9} height={32} />
            <YAxis width={56} tickCount={5} domain={[0, "auto"]} tickFormatter={(value: number) => `${compactMoneyFormat.format(value)} ₽`} tick={{ fill: "#839088", fontSize: 11 }} tickLine={false} axisLine={false} />
            <ReferenceLine y={0} stroke="#8e9992" strokeWidth={1.5} />
            <Tooltip trigger={tooltip.trigger} content={ProductProfitTooltip} cursor={{ stroke: "rgba(22, 136, 95, .35)" }} isAnimationActive={false} />
            {visibleProducts.map((product) => {
              const index = products.findIndex((candidate) => candidate.id === product.id);
              return <Line key={product.id} dataKey={`profit_${product.id}`} name={`${product.title} · ${product.sku}`} type="monotone" stroke={productLineColors[index % productLineColors.length]} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="analytics-empty">За выбранный период нет продаж с положительной прибылью.</p>}
    </div>
  </section>;
}

function RateChart({ points, days }: { points: RatePoint[]; days: TrendDay[] }) {
  const tooltip = useChartTooltipTrigger();
  const firstDay = days[0]?.date;
  const lastDay = days.at(-1)?.date;
  const domain: [number, number] = firstDay && lastDay
    ? [moscowDayStart(firstDay), moscowDayStart(lastDay) + 86_400_000]
    : [0, 1];
  return <section className="panel analytics-chart-panel analytics-added-cost-panel">
    <div className="panel-head"><h2>Добавочная стоимость</h2></div>
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
            <Line dataKey="ratePercent" name="Добавочная стоимость" type="stepAfter" stroke="#16885f" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 6, strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="analytics-empty">За выбранный период нет заказов с рассчитанным процентом.</p>}
    </div>
  </section>;
}

export function AnalyticsWorkspace() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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

  const rangeDays = useMemo(() => (data?.days ?? []).filter((day) => day.date >= dateFrom && day.date <= dateTo), [data?.days, dateFrom, dateTo]);
  useEffect(() => setBrushRange({ startIndex: 0, endIndex: Math.max(0, rangeDays.length - 1) }), [dateFrom, dateTo, rangeDays.length]);
  const lastIndex = Math.max(0, rangeDays.length - 1);
  const startIndex = Math.min(brushRange.startIndex, lastIndex);
  const endIndex = Math.max(startIndex, Math.min(brushRange.endIndex, lastIndex));
  const visibleDays = rangeDays.slice(startIndex, endIndex + 1);
  const visibleDates = useMemo(() => new Set(visibleDays.map((day) => day.date)), [visibleDays]);
  const visibleRates = useMemo(() => (data?.ratePoints ?? []).filter((point) => visibleDates.has(point.date)), [data?.ratePoints, visibleDates]);
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
      <UnitsChart days={visibleDays} />
      <ProductProfitChart days={visibleDays} products={data.catalogProducts} productProfitDays={data.productProfitDays.filter((point) => visibleDates.has(point.date))} />
      <RateChart points={visibleRates} days={visibleDays} />
      <BuyoutChart days={visibleDays} />
    </div>}
  </>;
}
