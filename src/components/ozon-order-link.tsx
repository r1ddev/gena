import type { ReactNode } from "react";

export function OzonOrderLink({ postingNumber, children }: { postingNumber: string; children?: ReactNode }) {
  if (!postingNumber) return children ?? null;
  const href = `https://seller.ozon.ru/app/postings/fbo?statusAlias=all&postingNumber=${encodeURIComponent(postingNumber)}`;

  return <a className="ozon-order-link" href={href} target="_blank" rel="noopener noreferrer">
    {children ?? postingNumber}
  </a>;
}
