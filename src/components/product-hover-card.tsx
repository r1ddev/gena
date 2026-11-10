"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImageOff } from "lucide-react";
import { findRows, getId, requestJson, stringValue, type JsonRecord } from "./api";

type ProductInfo = {
  id: string;
  sku: string;
  offerId: string;
  ozonSku: string;
  title: string;
  imageUrl: string;
};

const ProductCatalogContext = createContext<ProductInfo[]>([]);
export const PRODUCT_CATALOG_CHANGED_EVENT = "product-catalog-changed";

export function notifyProductCatalogChanged() {
  window.dispatchEvent(new Event(PRODUCT_CATALOG_CHANGED_EVENT));
}

function productInfo(row: JsonRecord): ProductInfo | null {
  const id = getId(row);
  if (!id) return null;
  return {
    id,
    sku: stringValue(row.sku) ?? "",
    offerId: stringValue(row.offerId) ?? "",
    ozonSku: stringValue(row.ozonSku) ?? "",
    title: stringValue(row.title) ?? "",
    imageUrl: stringValue(row.imageUrl) ?? "",
  };
}

export function ProductCatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const refresh = useCallback(async () => {
    try {
      const rows = findRows(await requestJson("/api/products"));
      setProducts(rows.map(productInfo).filter((product): product is ProductInfo => product !== null));
    } catch {
      setProducts([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(PRODUCT_CATALOG_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PRODUCT_CATALOG_CHANGED_EVENT, refresh);
  }, [refresh]);

  return <ProductCatalogContext.Provider value={products}>{children}</ProductCatalogContext.Provider>;
}

type ProductArticleProps = {
  identifier: string;
  productId?: string | null;
  identifierLabel?: "Артикул" | "SKU Ozon";
  fallback?: JsonRecord;
  className?: string;
  stopClickPropagation?: boolean;
};

export function ProductArticle({ identifier, productId, identifierLabel = "Артикул", fallback, className, stopClickPropagation = false }: ProductArticleProps) {
  const products = useContext(ProductCatalogContext);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });

  const product = (productId ? products.find((item) => item.id === productId) : undefined)
    ?? products.find((item) => [item.offerId, item.ozonSku, item.sku].includes(identifier));
  const sellerArticle = product?.offerId || stringValue(fallback?.offerId)
    || (identifierLabel === "Артикул" ? stringValue(fallback?.sku) ?? identifier : "");
  const ozonSku = product?.ozonSku || stringValue(fallback?.ozonSku)
    || (identifierLabel === "SKU Ozon" ? identifier : "");
  const title = product?.title || stringValue(fallback?.title) || stringValue(fallback?.productName) || "";
  const imageUrl = product?.imageUrl || stringValue(fallback?.imageUrl) || "";

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const card = cardRef.current;
    if (!trigger || !card) return;
    const anchor = trigger.getBoundingClientRect();
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - card.offsetWidth - margin);
    const left = Math.min(Math.max(margin, anchor.left), maxLeft);
    const below = anchor.bottom + 8;
    const top = below + card.offsetHeight <= window.innerHeight - margin
      ? below
      : Math.max(margin, anchor.top - card.offsetHeight - 8);
    setPosition({ left, top, ready: true });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition, title, imageUrl, sellerArticle, ozonSku]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  useEffect(() => setImageFailed(false), [imageUrl]);

  function cancelHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }

  function scheduleHide() {
    cancelHide();
    hideTimer.current = setTimeout(() => setOpen(false), 140);
  }

  if (!identifier) return null;
  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`product-article-trigger${className ? ` ${className}` : ""}`}
      tabIndex={stopClickPropagation ? -1 : 0}
      aria-label={`Информация о товаре: ${identifier}`}
      aria-describedby={open ? tooltipId : undefined}
      onPointerEnter={() => { cancelHide(); setOpen(true); }}
      onPointerLeave={scheduleHide}
      onFocus={() => { cancelHide(); setOpen(true); }}
      onBlur={scheduleHide}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      onClick={(event) => { if (stopClickPropagation) event.stopPropagation(); }}
    >{identifier}</button>
    {open && typeof document !== "undefined" && createPortal(
      <div
        ref={cardRef}
        id={tooltipId}
        className="product-hover-card"
        role="tooltip"
        style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}
        onPointerEnter={cancelHide}
        onPointerLeave={scheduleHide}
        onClick={(event) => { if (stopClickPropagation) event.stopPropagation(); }}
      >
        <div className="product-hover-image">
          {imageUrl && !imageFailed
            ? <img src={imageUrl} alt="" onError={() => setImageFailed(true)} />
            : <ImageOff size={22} aria-hidden="true" />}
        </div>
        <div className="product-hover-details">
          <strong className="product-hover-title">{title || "Название не указано"}</strong>
          <div className="product-hover-field"><span>Артикул</span><b>{sellerArticle || "—"}</b></div>
          <div className="product-hover-field"><span>SKU Ozon</span><b>{ozonSku || "—"}</b></div>
        </div>
      </div>,
      document.body,
    )}
  </>;
}
