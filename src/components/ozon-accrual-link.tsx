import type { ReactNode } from "react";

export function OzonAccrualLink({ accrualNumber, children }: { accrualNumber: string; children?: ReactNode }) {
  if (!accrualNumber) return children ?? null;
  const href = `https://seller.ozon.ru/app/finances/accruals?search=${encodeURIComponent(accrualNumber)}&tab=ACCRUALS_DETAILS`;

  return <a className="ozon-order-link" href={href} target="_blank" rel="noopener noreferrer">
    {children ?? accrualNumber}
  </a>;
}
