"use client";

import { ResourcePage } from "@/components/resource-page";
import { OzonAccrualLink } from "@/components/ozon-accrual-link";
import { OzonExpenseInfo, type OzonExpenseCompensationDetail, type OzonExpenseComponent, type OzonExpenseProduct } from "@/components/ozon-expense-info";
import { OzonOrderLink } from "@/components/ozon-order-link";

export default function OzonExpensesPage() {
  return <ResourcePage config={{
    title: "Операции Ozon", eyebrow: "Деньги и затраты",
    description: "Операции Ozon без привязки к отправлению покупателю. Списание отображается со знаком минус, начисление — со знаком плюс. Операции до даты начала учёта остаются в списке, но в расчёты не входят.",
    collectionUrl: "/api/expenses?source=ozon", createUrl: "/api/expenses", hideCreate: true,
    fields: [],
    columns: [
      { key: "spentAt", label: "Дата", kind: "date" },
      {
        key: "description", label: "Операция", primary: true,
        render: (row, value) => {
          const label = typeof value === "string" ? value : "Операция Ozon";
          const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
          const accountingTreatment = typeof row.accountingTreatment === "string" ? row.accountingTreatment : "";
          const typeId = typeof row.typeId === "string" ? row.typeId : "";
          const relatedSkus = Array.isArray(row.relatedSkus) ? row.relatedSkus.filter((sku): sku is string => typeof sku === "string") : [];
          const relatedOfferIds = Array.isArray(row.relatedOfferIds) ? row.relatedOfferIds.filter((offerId): offerId is string => typeof offerId === "string") : [];
          const relatedProducts = Array.isArray(row.relatedProducts) ? row.relatedProducts as OzonExpenseProduct[] : [];
          const components = Array.isArray(row.components) ? row.components as OzonExpenseComponent[] : [];
          const compensationDetails = Array.isArray(row.compensationDetails) ? row.compensationDetails as OzonExpenseCompensationDetail[] : [];
          return <span className="ozon-expense-operation">
            <OzonExpenseInfo
              label={label}
              typeId={typeId}
              amount={Number.isFinite(amount) ? amount : null}
              date={typeof row.spentAt === "string" ? row.spentAt : ""}
              unitNumber={typeof row.unitNumber === "string" ? row.unitNumber : ""}
              accruedCategory={typeof row.accruedCategory === "string" ? row.accruedCategory : ""}
              accountingTreatment={accountingTreatment}
              relatedSkus={relatedSkus}
              relatedOfferIds={relatedOfferIds}
              relatedProducts={relatedProducts}
              components={components}
              compensationDetails={compensationDetails}
            />
          </span>;
        },
      },
      {
        key: "note",
        label: "Артикул / детали",
        render: (row) => {
          const ozonSku = typeof row.ozonSku === "string" ? row.ozonSku : "";
          const typeId = typeof row.typeId === "string" ? row.typeId : "";
          const unitNumber = typeof row.unitNumber === "string" ? row.unitNumber : "";
          const accrualNumber = typeId === "71" || unitNumber.startsWith("sr01-");
          const postingNumber = /^\d+-\d+(?:-\d+)?$/.test(unitNumber);
          return <span>
            {ozonSku && <>SKU Ozon {ozonSku}{unitNumber ? " · " : ""}</>}
            {accrualNumber ? <OzonAccrualLink accrualNumber={unitNumber}>{unitNumber}</OzonAccrualLink>
              : postingNumber ? <OzonOrderLink postingNumber={unitNumber}>{unitNumber}</OzonOrderLink>
                : unitNumber}
          </span>;
        },
      },
      { key: "accountingTreatment", label: "Как учтено" },
      { key: "amount", label: "Сумма Ozon", kind: "money" },
    ],
    emptyTitle: "Операций Ozon пока нет",
    emptyDescription: "Операции появятся после синхронизации финансовых данных Ozon.",
  }} />;
}
