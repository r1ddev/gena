import type { ReactNode } from "react";

export function OzonReturnLink({ returnId, children }: { returnId: string; children?: ReactNode }) {
  if (!returnId) return children ?? null;
  const href = `https://seller.ozon.ru/app/returns/details?id=${encodeURIComponent(returnId)}&type=1`;

  return <a className="ozon-order-link" href={href} target="_blank" rel="noopener noreferrer">
    {children ?? returnId}
  </a>;
}
