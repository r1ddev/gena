"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ImageOff, Search } from "lucide-react";
import { findRows, getId, stringValue, type JsonRecord } from "./api";

export type ProductSelectOption = {
  id: string;
  title: string;
  sku: string;
  offerId: string;
  ozonSku: string;
  imageUrl: string;
};

export function productSelectOptions(value: unknown): ProductSelectOption[] {
  return findRows(value).flatMap((row) => {
    const id = getId(row);
    if (!id) return [];
    return [{
      id,
      title: stringValue(row.title) ?? "Название не указано",
      sku: stringValue(row.sku) ?? "",
      offerId: stringValue(row.offerId) ?? "",
      ozonSku: stringValue(row.ozonSku) ?? "",
      imageUrl: stringValue(row.imageUrl) ?? "",
    }];
  });
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

function articleOf(product: ProductSelectOption) {
  return product.offerId || product.sku;
}

function ProductPhoto({ product, large = false }: { product: ProductSelectOption; large?: boolean }) {
  return <span className={`product-select-photo${large ? " large" : ""}`}>
    <ImageOff size={large ? 20 : 16} aria-hidden="true" />
    {product.imageUrl && <img src={product.imageUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
  </span>;
}

function ProductDetails({ product, option = false }: { product: ProductSelectOption; option?: boolean }) {
  const article = articleOf(product);
  return <span className={`product-select-details${option ? " option" : ""}`}>
    <strong>{product.title}</strong>
    <span>Артикул: {article || "не указан"}</span>
    <span>SKU Ozon: {product.ozonSku || "не указан"}</span>
  </span>;
}

export function ProductSelect({
  id,
  value,
  products,
  onChange,
  required = false,
  placeholder = "Выберите товар…",
  fallbackOption,
  disabled = false,
  ariaLabel,
}: {
  id: string;
  value: string;
  products: ProductSelectOption[];
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  fallbackOption?: ProductSelectOption;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showRequired, setShowRequired] = useState(false);
  const listboxId = `${id}-options`;
  const selected = products.find((product) => product.id === value)
    ?? (fallbackOption?.id === value ? fallbackOption : undefined);
  const matches = useMemo(() => {
    const search = normalized(query);
    const options = fallbackOption && !products.some((product) => product.id === fallbackOption.id)
      ? [fallbackOption, ...products]
      : products;
    if (!search) return options;
    return options.filter((product) => normalized([
      product.title,
      product.sku,
      product.offerId,
      product.ozonSku,
    ].join(" ")).includes(search));
  }, [fallbackOption, products, query]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
        setActiveIndex(-1);
      }
    }
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function choose(product: ProductSelectOption) {
    onChange(product.id);
    setShowRequired(false);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && matches.length) {
      event.preventDefault();
      setActiveIndex((current) => current < matches.length - 1 ? current + 1 : 0);
    } else if (event.key === "ArrowUp" && matches.length) {
      event.preventDefault();
      setActiveIndex((current) => current > 0 ? current - 1 : matches.length - 1);
    } else if (event.key === "Enter" && matches.length) {
      event.preventDefault();
      choose(matches[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
      triggerRef.current?.focus();
    }
  }

  return <div className="product-select" ref={rootRef}>
    <button
      ref={triggerRef}
      id={id}
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-label={ariaLabel}
      aria-required={required || undefined}
      aria-invalid={showRequired || undefined}
      className={`product-select-trigger${showRequired ? " invalid" : ""}`}
      disabled={disabled}
      onClick={() => {
        setOpen((current) => !current);
        setQuery("");
        setActiveIndex(-1);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setOpen(true);
          setActiveIndex(0);
        }
      }}
    >
      {selected ? <><ProductPhoto product={selected} large /><ProductDetails product={selected} /></> : <span className="product-select-placeholder">{placeholder}</span>}
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    <input
      className="product-select-validation"
      type="text"
      tabIndex={-1}
      aria-hidden="true"
      required={required}
      value={value}
      onChange={() => undefined}
      onInvalid={(event) => {
        event.preventDefault();
        setShowRequired(true);
        setOpen(true);
        triggerRef.current?.focus();
      }}
    />
    {showRequired && <span className="product-select-error" role="alert">Выберите товар из списка.</span>}
    {open && <div className="product-select-popover">
      <div className="product-select-search"><Search size={15} aria-hidden="true" /><input
        ref={searchRef}
        type="search"
        role="searchbox"
        aria-label="Поиск товара"
        aria-activedescendant={activeIndex >= 0 && matches[activeIndex] ? `${id}-option-${matches[activeIndex].id}` : undefined}
        aria-controls={listboxId}
        autoComplete="off"
        placeholder="Название, артикул или SKU Ozon"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
        onKeyDown={onSearchKeyDown}
      /></div>
      <div id={listboxId} className="product-select-options" role="listbox" aria-label="Товары каталога">
        {matches.length === 0 ? <div className="product-select-empty">Товары не найдены</div> : matches.map((product, index) => <div
          id={`${id}-option-${product.id}`}
          key={product.id}
          className={`product-select-option${index === activeIndex ? " active" : ""}${product.id === value ? " selected" : ""}`}
          role="option"
          aria-selected={product.id === value}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(product)}
        >
          <ProductPhoto product={product} />
          <ProductDetails product={product} option />
        </div>)}
      </div>
    </div>}
  </div>;
}

export function productFallbackOption(id: string, row: JsonRecord): ProductSelectOption {
  return {
    id,
    title: stringValue(row.title) ?? "Название товара не сохранено",
    sku: stringValue(row.sku) ?? "",
    offerId: stringValue(row.offerId) ?? "",
    ozonSku: stringValue(row.ozonSku) ?? "",
    imageUrl: stringValue(row.imageUrl) ?? "",
  };
}
