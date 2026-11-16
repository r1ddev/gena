"use client";

import { CircleHelp, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OzonOrderLink } from "@/components/ozon-order-link";

export type OzonExpenseProduct = {
  id: string;
  title: string;
  article: string;
  offerId: string;
  ozonSku: string;
  imageUrl: string | null;
  quantity: number | null;
};

export type OzonExpenseComponent = {
  typeId: string;
  label: string;
  amount: number;
  sku: string | null;
  quantity: number | null;
};

export type OzonExpenseCompensationDetail = {
  reportMonth: string;
  reportNumber: string;
  rowNumber: number;
  compensationType: string;
  productName: string;
  offerId: string;
  ozonSku: string;
  barcode: string;
  quantity: number | null;
  postingReferences: string[];
  markingCode: string;
  commissionInvoices: string[];
  declaredUnitValue: number | null;
  declaredTotalValue: number | null;
  reducedAmount: number | null;
  amount: number;
};

type OzonExpenseInfoProps = {
  label: string;
  typeId: string;
  amount: number | null;
  date: string;
  unitNumber: string;
  accruedCategory: string;
  accountingTreatment: string;
  relatedSkus: string[];
  relatedOfferIds: string[];
  relatedProducts: OzonExpenseProduct[];
  components: OzonExpenseComponent[];
  compensationDetails: OzonExpenseCompensationDetail[];
};

function formatRubles(value: number) {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(date);
}

function expenseExplanation(label: string, treatment: string, typeId: string) {
  const specificDescription = typeId === "77"
    ? "Это плата за обработку товара при входящей поставке."
    : typeId === "3"
      ? "Это начисление за продвижение бренда."
      : typeId === "1"
        ? "Это комиссия за обработку платежа."
        : "";
  const typeDescription = specificDescription || (["Другая операция Ozon", "Операция по товару", "Операция Ozon"].includes(label)
    ? "В доступных данных Ozon нет подробного названия этой операции."
    : "");

  let accountingDescription = treatment;
  if (treatment.startsWith("До даты начала учёта")) {
    accountingDescription = "Запись остаётся в истории Ozon, но не входит в расчёты из-за даты операции.";
  } else if (treatment === "Увеличивает добавочную стоимость") {
    accountingDescription = "Списание входит в общие расходы Ozon и распределяется между товарами пропорционально закупочной стоимости.";
  } else if (treatment === "Уменьшает добавочную стоимость") {
    accountingDescription = "Начисление уменьшает общие расходы Ozon, распределяемые между товарами пропорционально их закупочной стоимости.";
  } else if (treatment.startsWith("Компенсация")) {
    accountingDescription = "Компенсация учитывается отдельно в прибыли и не распределяется по стоимости товаров.";
  } else if (treatment === "Не влияет на добавочную стоимость") {
    accountingDescription = "Эта операция не меняет добавочную стоимость товаров.";
  } else if (!treatment) {
    accountingDescription = "Способ учёта этой операции не указан.";
  }

  return [typeDescription, accountingDescription].filter(Boolean).join(" ");
}

export function OzonExpenseInfo({
  label,
  typeId,
  amount,
  date,
  unitNumber,
  accruedCategory,
  accountingTreatment,
  relatedSkus,
  relatedOfferIds,
  relatedProducts,
  components,
  compensationDetails,
}: OzonExpenseInfoProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [imageErrors, setImageErrors] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const amountDescription = amount === null
    ? "Сумма операции не указана."
    : amount < 0
      ? `Ozon списал ${formatRubles(Math.abs(amount))} ₽.`
      : amount > 0
        ? `Ozon начислил ${formatRubles(amount)} ₽.`
        : "Сумма операции — 0 ₽.";
  const explanation = expenseExplanation(label, accountingTreatment, typeId);

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="ozon-expense-info-trigger"
      aria-label={`Открыть расход «${label}»`}
      aria-expanded={open}
      aria-controls={id}
      onClick={() => setOpen((current) => !current)}
    >
      <span className="table-primary ozon-expense-operation-label">{label}</span>
      <span className="ozon-expense-info-icon"><CircleHelp size={14} aria-hidden="true" /></span>
    </button>
    {open && typeof document !== "undefined" && createPortal(
      <div
        className="product-edit-backdrop ozon-expense-dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <section
          id={id}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          className="panel product-edit-dialog ozon-expense-dialog"
        >
          <div className="panel-head">
            <div>
              <h2 id={`${id}-title`}>{label}</h2>
              <span className="small-note">{formatDate(date)} · {amountDescription}</span>
            </div>
            <button type="button" className="icon-button" aria-label="Закрыть расход" onClick={() => setOpen(false)}><X size={15} /></button>
          </div>
          <div className="panel-body ozon-expense-dialog-body">
            <div className="ozon-expense-facts">
              <div><span>Сумма</span><strong>{amount === null ? "—" : `${formatRubles(amount)} ₽`}</strong></div>
              <div><span>Вид записи Ozon</span><strong>{accruedCategory || "Не указан"}</strong></div>
              <div><span>Код операции Ozon</span><strong>{typeId || "Не указан"}</strong></div>
              {unitNumber && <div><span>Номер в Ozon</span><strong>{unitNumber}</strong></div>}
            </div>

            {compensationDetails.length > 0 && <section className="ozon-expense-detail-section" aria-labelledby={`${id}-compensation`}>
              <h3 id={`${id}-compensation`}>За что начислили компенсацию</h3>
              <div className="ozon-expense-components">
                {compensationDetails.map((detail) => <article className="ozon-expense-compensation" key={`${detail.reportMonth}-${detail.rowNumber}`}>
                  <strong>{detail.compensationType || "Компенсация"}</strong>
                  {detail.productName && <span>{detail.productName}</span>}
                  {(detail.offerId || detail.ozonSku || detail.barcode) && <span>
                    {[detail.offerId ? `Артикул ${detail.offerId}` : "", detail.ozonSku ? `SKU Ozon ${detail.ozonSku}` : "", detail.barcode ? `Штрихкод ${detail.barcode}` : ""].filter(Boolean).join(" · ")}
                  </span>}
                  {detail.quantity !== null && <span>Количество: {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(detail.quantity)} шт.</span>}
                  {detail.declaredUnitValue !== null && <span>Заявленная цена за штуку: {formatRubles(detail.declaredUnitValue)} ₽</span>}
                  {detail.declaredTotalValue !== null && <span>Заявленная сумма: {formatRubles(detail.declaredTotalValue)} ₽</span>}
                  {detail.reducedAmount !== null && <span>Уменьшение суммы: {formatRubles(detail.reducedAmount)} ₽</span>}
                  <span>Сумма компенсации: {formatRubles(detail.amount)} ₽</span>
                  {detail.markingCode && <span>Код маркировки: {detail.markingCode}</span>}
                  {detail.postingReferences.length > 0 && <span className="ozon-expense-compensation-links">
                    Отправления: {detail.postingReferences.map((postingNumber, index) => <span key={postingNumber}>
                      {index > 0 ? ", " : ""}<OzonOrderLink postingNumber={postingNumber} />
                    </span>)}
                  </span>}
                  {detail.commissionInvoices.length > 0 && <span>Накладные Ozon: {detail.commissionInvoices.join(", ")}</span>}
                  {detail.reportNumber && <span>Отчёт Ozon № {detail.reportNumber} · {detail.reportMonth}</span>}
                </article>)}
              </div>
            </section>}

            <section className="ozon-expense-detail-section" aria-labelledby={`${id}-products`}>
              <h3 id={`${id}-products`}>Какие товары связаны</h3>
              {relatedProducts.length > 0 ? <div className="ozon-expense-products">
                {relatedProducts.map((product) => <article className="ozon-expense-product" key={product.id}>
                  {product.imageUrl && !imageErrors.has(product.id)
                    ? <img
                        className="ozon-expense-product-image"
                        src={product.imageUrl}
                        alt=""
                        onError={() => setImageErrors((current) => new Set(current).add(product.id))}
                      />
                    : <div className="ozon-expense-product-placeholder" aria-hidden="true">Товар</div>}
                  <div className="ozon-expense-product-copy">
                    <strong>{product.title || "Без названия"}</strong>
                    <span>Артикул: {product.article || product.offerId || "—"}</span>
                    <span>SKU Ozon: {product.ozonSku || "—"}</span>
                    {product.quantity !== null && <span>Количество: {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(product.quantity)} шт.</span>}
                  </div>
                </article>)}
              </div> : <div className="ozon-expense-detail-empty">
                {relatedSkus.length || relatedOfferIds.length
                  ? <>Ozon указал идентификаторы, но сопоставить их с товаром каталога не удалось: {[...relatedOfferIds, ...relatedSkus].join(", ")}.</>
                  : "В записи Ozon нет артикула или SKU, по которым можно определить товар."}
              </div>}
            </section>

            {compensationDetails.length === 0 && <section className="ozon-expense-detail-section" aria-labelledby={`${id}-composition`}>
              <h3 id={`${id}-composition`}>Из чего состоит сумма</h3>
              {components.length > 0 ? <div className="ozon-expense-components">
                {components.map((component, index) => <div className="ozon-expense-component" key={`${component.typeId}-${component.sku ?? "all"}-${index}`}>
                  <span>{component.label}{component.sku ? ` · SKU ${component.sku}` : ""}{component.quantity !== null ? ` · ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(component.quantity)} шт.` : ""}</span>
                  <strong>{formatRubles(component.amount)} ₽</strong>
                </div>)}
              </div> : <p className="ozon-expense-detail-empty">Ozon передал эту запись одной суммой, без разбивки на составляющие.</p>}
            </section>}

            {explanation && <section className="ozon-expense-detail-section" aria-labelledby={`${id}-accounting`}>
              <h3 id={`${id}-accounting`}>Как учтено в сервисе</h3>
              <p>{explanation}</p>
            </section>}
          </div>
        </section>
      </div>,
      document.body,
    )}
  </>;
}
