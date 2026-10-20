"use client";

import type { ReactNode } from "react";

export type TableColumn<Row> = {
  key: string;
  label: string;
  kind?: "text" | "identifier" | "date" | "time" | "number" | "money" | "quantity" | "status";
  sortable?: boolean;
  filterable?: boolean;
  value?: (row: Row) => unknown;
};

export type TableSort = { key: string; direction: "asc" | "desc" } | null;

export function columnIsSortable<Row>(column: TableColumn<Row>) {
  return column.sortable ?? ["identifier", "date", "time", "number", "money", "quantity"].includes(column.kind ?? "");
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

function comparable(value: unknown, kind: TableColumn<unknown>["kind"]) {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "date" || kind === "time") {
    const timestamp = new Date(String(value)).getTime();
    return Number.isFinite(timestamp) ? timestamp : String(value);
  }
  if (kind === "money" || kind === "quantity" || kind === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  return String(value);
}

export function filterAndSortRows<Row>(rows: Row[], columns: TableColumn<Row>[], filters: Record<string, string>, sort: TableSort) {
  const activeFilters = Object.entries(filters).filter(([, value]) => value.trim());
  const filtered = rows.filter((row) => activeFilters.every(([key, value]) => {
    const column = columns.find((candidate) => candidate.key === key);
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
  filters,
  onFilter,
  sort,
  onSort,
  trailingHeaders = [],
}: {
  columns: TableColumn<Row>[];
  filters: Record<string, string>;
  onFilter: (key: string, value: string) => void;
  sort: TableSort;
  onSort: (key: string) => void;
  trailingHeaders?: ReactNode[];
}) {
  return <thead>
    <tr>{columns.map((column) => {
      const sortable = columnIsSortable(column);
      const active = sort?.key === column.key;
      const sortState = active ? sort.direction === "asc" ? "ascending" : "descending" : "none";
      return <th key={column.key} scope="col" aria-sort={sortable ? sortState : undefined}>
        {sortable
          ? <button type="button" className="table-sort-button" onClick={() => onSort(column.key)} aria-label={`Сортировать по полю «${column.label}» ${active && sort.direction === "asc" ? "по убыванию" : "по возрастанию"}`}>
            {column.label}<span className="table-sort-indicator" aria-hidden="true">{active ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
          </button>
          : <span>{column.label}</span>}
      </th>;
    })}{trailingHeaders.map((header, index) => <th key={`trailing-${index}`} scope="col">{header}</th>)}</tr>
    <tr className="table-filter-row" aria-label="Фильтры таблицы">
      {columns.map((column) => <th key={column.key} scope="col">
        {column.filterable === false ? null : <input
          type={column.kind === "date" ? "date" : "search"}
          aria-label={`Фильтр: ${column.label}`}
          placeholder={column.kind === "date" ? undefined : "Фильтр"}
          value={filters[column.key] ?? ""}
          onChange={(event) => onFilter(column.key, event.target.value)}
        />}
      </th>)}
      {trailingHeaders.map((_, index) => <th key={`trailing-filter-${index}`} aria-hidden="true" />)}
    </tr>
  </thead>;
}

export function TableEmptyRow({ colSpan, message, onClear }: { colSpan: number; message: string; onClear?: () => void }) {
  return <tr className="table-empty-row">
    <td colSpan={colSpan}>
      <div role="status">{message}</div>
      {onClear && <button type="button" className="button secondary small" style={{ marginTop: 10 }} onClick={onClear}>Очистить фильтры</button>}
    </td>
  </tr>;
}
