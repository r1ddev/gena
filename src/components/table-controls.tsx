"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const TABLE_PAGE_SIZE = 50;

export type TableColumn<Row> = {
  key: string;
  label: string;
  kind?: "text" | "identifier" | "date" | "time" | "number" | "money" | "quantity" | "percent" | "status";
  sortable?: boolean;
  filterable?: boolean;
  value?: (row: Row) => unknown;
};

export type TableSort = { key: string; direction: "asc" | "desc" } | null;
export type DateRangeFilter = { from: string; to: string };

export function readDateRangeFilter(value: string): DateRangeFilter {
  if (!value) return { from: "", to: "" };
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "from" in parsed && "to" in parsed) {
      const range = parsed as { from?: unknown; to?: unknown };
      return { from: typeof range.from === "string" ? range.from : "", to: typeof range.to === "string" ? range.to : "" };
    }
  } catch {
    // Keep compatibility with a previously stored single-day filter.
  }
  return { from: value, to: value };
}

function dateKey(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = String(value);
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (dateOnly) return dateOnly[1];
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

type PageItem = number | "ellipsis";

function pageItems(currentPage: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function paginateRows<Row>(rows: Row[], requestedPage: number, pageSize = TABLE_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page, totalPages };
}

export function TablePagination({
  page,
  pageSize,
  total,
  label,
  busy = false,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  busy?: boolean;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const changePage = (nextPage: number) => {
    if (!busy && nextPage >= 1 && nextPage <= totalPages && nextPage !== page) onPageChange(nextPage);
  };

  return <nav className="pagination-controls" aria-label={`Страницы таблицы «${label}»`} aria-busy={busy}>
    <span className="pagination-range">{firstRow}–{lastRow} из {total}</span>
    <div className="pagination-buttons">
      <button type="button" className="pagination-page" aria-label="Предыдущая страница" disabled={busy || page <= 1} onClick={() => changePage(page - 1)}>‹</button>
      {pageItems(page, totalPages).map((item, index) => item === "ellipsis"
        ? <span className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
        : <button
          className={`pagination-page ${page === item ? "active" : ""}`}
          key={item}
          type="button"
          aria-label={`Страница ${item}`}
          aria-current={page === item ? "page" : undefined}
          disabled={busy || page === item}
          onClick={() => changePage(item)}
        >{item}</button>)}
      <button type="button" className="pagination-page" aria-label="Следующая страница" disabled={busy || page >= totalPages} onClick={() => changePage(page + 1)}>›</button>
    </div>
  </nav>;
}

export function cycleTableSort(current: TableSort, key: string): TableSort {
  if (current?.key !== key) return { key, direction: "desc" };
  if (current.direction === "desc") return { key, direction: "asc" };
  return null;
}

export function columnIsSortable<Row>(column: TableColumn<Row>) {
  return column.sortable ?? ["identifier", "date", "time", "number", "money", "quantity", "percent"].includes(column.kind ?? "");
}

function columnValue<Row>(row: Row, column: TableColumn<Row>) {
  if (column.value) return column.value(row);
  return (row as Record<string, unknown>)[column.key];
}

function filterText<Row>(row: Row, column: TableColumn<Row>) {
  const value = columnValue(row, column);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(" ").toLocaleLowerCase("ru-RU");
  if (typeof value === "object") return JSON.stringify(value).toLocaleLowerCase("ru-RU");
  return String(value).toLocaleLowerCase("ru-RU");
}

function filterSuggestionValue<Row>(row: Row, column: TableColumn<Row>) {
  const value = columnValue(row, column);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(" ").trim();
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

type FilterMenuPosition = { left: number; top: number; width: number; maxHeight: number; above: boolean };

function TableFilterInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const inputId = useId().replace(/:/g, "");
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<FilterMenuPosition | null>(null);
  const query = value.trim().toLocaleLowerCase("ru-RU");
  const matchingOptions = useMemo(
    () => query ? options.filter((option) => option.toLocaleLowerCase("ru-RU").includes(query)) : options,
    [options, query],
  );
  const listId = `table-filter-options-${inputId}`;

  const updatePosition = () => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - 8);
    const availableAbove = Math.max(0, rect.top - 8);
    const above = availableBelow < 180 && availableAbove > availableBelow;
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
    setPosition({
      left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
      top: above ? rect.top : rect.bottom,
      width,
      maxHeight: Math.max(80, Math.min(280, above ? availableAbove : availableBelow)),
      above,
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!matchingOptions.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (current < 0) return event.key === "ArrowDown" ? 0 : matchingOptions.length - 1;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + matchingOptions.length) % matchingOptions.length;
      });
    } else if (event.key === "Enter" && open && activeIndex >= 0 && matchingOptions[activeIndex]) {
      event.preventDefault();
      onChange(matchingOptions[activeIndex]);
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const menu = open && position && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      id={listId}
      className="table-filter-options"
      role="listbox"
      aria-label={`Варианты для фильтра «${label}»`}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transform: position.above ? "translateY(-100%)" : undefined }}
    >
      {matchingOptions.length ? matchingOptions.map((option, index) => <div
        key={`${option}-${index}`}
        id={`${listId}-option-${index}`}
        className={`table-filter-option${activeIndex === index ? " active" : ""}`}
        role="option"
        aria-selected={value === option}
        title={option}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => { onChange(option); setOpen(false); setActiveIndex(-1); }}
      >{option}</div>) : <div className="table-filter-empty">{options.length ? "Совпадений нет" : "Нет значений"}</div>}
    </div>,
    document.body,
  ) : null;

  return <div className="table-filter-combobox" ref={rootRef}>
    <input
      ref={inputRef}
      id={inputId}
      type="search"
      role="combobox"
      aria-label={`Фильтр: ${label}`}
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
      placeholder="Фильтр"
      value={value}
      onFocus={() => { setOpen(true); updatePosition(); }}
      onChange={(event) => { onChange(event.target.value); setActiveIndex(-1); setOpen(true); updatePosition(); }}
      onKeyDown={handleKeyDown}
    />
    {menu}
  </div>;
}

function comparable(value: unknown, kind: TableColumn<unknown>["kind"]) {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "date" || kind === "time") {
    const timestamp = new Date(String(value)).getTime();
    return Number.isFinite(timestamp) ? timestamp : String(value);
  }
  if (kind === "money" || kind === "quantity" || kind === "percent" || kind === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  return String(value);
}

export function filterAndSortRows<Row>(rows: Row[], columns: TableColumn<Row>[], filters: Record<string, string>, sort: TableSort) {
  const activeFilters = Object.entries(filters).filter(([, value]) => value.trim());
  const filtered = rows.filter((row) => activeFilters.every(([key, value]) => {
    const column = columns.find((candidate) => candidate.key === key);
    if (column?.kind === "date") {
      const range = readDateRangeFilter(value);
      if (!range.from && !range.to) return true;
      const date = dateKey(columnValue(row, column));
      return date !== null && (!range.from || date >= range.from) && (!range.to || date <= range.to);
    }
    return column && column.filterable !== false && filterText(row, column).includes(value.trim().toLocaleLowerCase("ru-RU"));
  }));
  if (!sort) return filtered;

  const column = columns.find((candidate) => candidate.key === sort.key);
  if (!column || !columnIsSortable(column)) return filtered;
  const collator = new Intl.Collator("ru-RU", { numeric: true, sensitivity: "base" });
  return filtered.map((row, index) => ({ row, index })).sort((left, right) => {
    const leftValue = comparable(columnValue(left.row, column), column.kind as TableColumn<unknown>["kind"]);
    const rightValue = comparable(columnValue(right.row, column), column.kind as TableColumn<unknown>["kind"]);
    if (leftValue === null || rightValue === null) {
      if (leftValue === rightValue) return left.index - right.index;
      return leftValue === null ? 1 : -1;
    }
    const order = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : collator.compare(String(leftValue), String(rightValue));
    return order === 0 ? left.index - right.index : sort.direction === "asc" ? order : -order;
  }).map(({ row }) => row);
}

export function TableHead<Row>({
  columns,
  rows = EMPTY_TABLE_ROWS as Row[],
  filterOptions = {},
  filters,
  onFilter,
  sort,
  onSort,
  trailingHeaders = [],
}: {
  columns: TableColumn<Row>[];
  rows?: Row[];
  filterOptions?: Record<string, string[]>;
  filters: Record<string, string>;
  onFilter: (key: string, value: string) => void;
  sort: TableSort;
  onSort: (key: string) => void;
  trailingHeaders?: ReactNode[];
}) {
  const optionsByColumn = useMemo(() => Object.fromEntries(columns.map((column) => {
    if (column.filterable === false || column.kind === "date") return [column.key, []];
    const unique = new Map<string, string>();
    for (const row of rows) {
      const value = filterSuggestionValue(row, column);
      const key = value.toLocaleLowerCase("ru-RU");
      if (key && !unique.has(key)) unique.set(key, value);
    }
    for (const value of filterOptions[column.key] ?? []) {
      const option = value.trim();
      const key = option.toLocaleLowerCase("ru-RU");
      if (key && !unique.has(key)) unique.set(key, option);
    }
    return [column.key, [...unique.values()].sort(new Intl.Collator("ru-RU", { numeric: true, sensitivity: "base" }).compare)];
  })), [columns, filterOptions, rows]);

  return <thead>
    <tr>{columns.map((column) => {
      const sortable = columnIsSortable(column);
      const active = sort?.key === column.key;
      const sortState = active ? sort.direction === "asc" ? "ascending" : "descending" : "none";
      const nextSortLabel = active ? sort.direction === "desc" ? "по возрастанию" : "сбросить сортировку" : "по убыванию";
      return <th key={column.key} scope="col" aria-sort={sortable ? sortState : undefined}>
        {sortable
          ? <button type="button" className="table-sort-button" onClick={() => onSort(column.key)} aria-label={`Сортировать по полю «${column.label}» ${nextSortLabel}`}>
            {column.label}<span className="table-sort-indicator" aria-hidden="true">{active ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
          </button>
          : <span>{column.label}</span>}
      </th>;
    })}{trailingHeaders.map((header, index) => <th key={`trailing-${index}`} scope="col">{header}</th>)}</tr>
    <tr className="table-filter-row" aria-label="Фильтры таблицы">
      {columns.map((column) => <th key={column.key} scope="col">
        {column.filterable === false ? null : column.kind === "date" ? (() => {
          const range = readDateRangeFilter(filters[column.key] ?? "");
          const updateRange = (nextRange: DateRangeFilter) => onFilter(column.key, nextRange.from || nextRange.to ? JSON.stringify(nextRange) : "");
          return <div className="table-date-filter">
            <label><span>От</span><input type="date" aria-label={`Фильтр «${column.label}»: от`} max={range.to || undefined} value={range.from} onChange={(event) => updateRange({ ...range, from: event.target.value })} /></label>
            <label><span>До</span><input type="date" aria-label={`Фильтр «${column.label}»: до`} min={range.from || undefined} value={range.to} onChange={(event) => updateRange({ ...range, to: event.target.value })} /></label>
          </div>;
        })() : <TableFilterInput label={column.label} options={optionsByColumn[column.key] ?? []} value={filters[column.key] ?? ""} onChange={(value) => onFilter(column.key, value)} />}
      </th>)}
      {trailingHeaders.map((_, index) => <th key={`trailing-filter-${index}`} aria-hidden="true" />)}
    </tr>
  </thead>;
}

const EMPTY_TABLE_ROWS: never[] = [];

export function TableEmptyRow({ colSpan, message, onClear }: { colSpan: number; message: string; onClear?: () => void }) {
  return <tr className="table-empty-row">
    <td colSpan={colSpan}>
      <div role="status">{message}</div>
      {onClear && <button type="button" className="button secondary small" style={{ marginTop: 10 }} onClick={onClear}>Очистить фильтры</button>}
    </td>
  </tr>;
}
