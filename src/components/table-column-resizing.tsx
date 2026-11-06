"use client";

import { useEffect } from "react";

const STORAGE_PREFIX = "gena.table-column-widths.v1";
const MIN_COLUMN_WIDTH = 56;
const MAX_COLUMN_WIDTH = 900;

function headerCells(table: HTMLTableElement) {
  const firstRow = table.tHead?.rows[0];
  return firstRow ? Array.from(firstRow.cells) : [];
}

function headerSignature(table: HTMLTableElement) {
  return headerCells(table).map((cell) => {
    const label = cell.querySelector<HTMLElement>(".table-sort-button") ?? cell;
    return (label.textContent ?? "").replace(/[↑↓↕]/g, "").replace(/\s+/g, " ").trim();
  }).join("|");
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function storageKey(table: HTMLTableElement) {
  const signature = headerSignature(table);
  const sameTables = Array.from(document.querySelectorAll("table")).filter((candidate) => headerSignature(candidate) === signature);
  const instance = Math.max(0, sameTables.indexOf(table));
  return `${STORAGE_PREFIX}:${window.location.pathname}:${hash(signature)}:${instance}`;
}

function readWidths(key: string, columnCount: number) {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (!Array.isArray(stored) || stored.length !== columnCount) return null;
    const widths = stored.map(Number);
    return widths.every((width) => Number.isFinite(width) && width >= MIN_COLUMN_WIDTH && width <= MAX_COLUMN_WIDTH) ? widths : null;
  } catch {
    return null;
  }
}

function clearTableWidths(table: HTMLTableElement) {
  table.style.removeProperty("table-layout");
  table.style.removeProperty("width");
  table.style.removeProperty("min-width");
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      cell.style.removeProperty("width");
      cell.style.removeProperty("min-width");
      cell.style.removeProperty("max-width");
    }
  }
  delete table.dataset.tableColumnResizeKey;
}

function applyTableWidths(table: HTMLTableElement, widths: number[], key: string) {
  const headers = headerCells(table);
  if (headers.length !== widths.length) return;
  const roundedWidths = widths.map((width) => Math.round(width));
  const tableWidth = roundedWidths.reduce((total, width) => total + width, 0);
  table.style.tableLayout = "fixed";
  table.style.width = `${tableWidth}px`;
  table.style.minWidth = `${tableWidth}px`;
  table.dataset.tableColumnResizeKey = key;

  for (const row of Array.from(table.rows)) {
    if (row.classList.contains("table-empty-row")) continue;
    for (const [index, cell] of Array.from(row.cells).entries()) {
      const width = roundedWidths[index];
      if (width === undefined) continue;
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;
      cell.style.maxWidth = `${width}px`;
    }
  }
}

function saveTableWidths(table: HTMLTableElement, widths: number[]) {
  try {
    window.localStorage.setItem(storageKey(table), JSON.stringify(widths.map((width) => Math.round(width))));
  } catch {
    // Resizing still works for this session when browser storage is unavailable.
  }
}

function restoreTableWidths() {
  for (const table of Array.from(document.querySelectorAll<HTMLTableElement>("table"))) {
    if (!table.tHead || headerCells(table).length === 0) continue;
    const key = storageKey(table);
    const previousKey = table.dataset.tableColumnResizeKey;
    const widths = readWidths(key, headerCells(table).length);
    if (widths) {
      applyTableWidths(table, widths, key);
    } else if (previousKey && previousKey !== key) {
      clearTableWidths(table);
    }
  }
}

function currentWidths(table: HTMLTableElement) {
  return headerCells(table).map((cell) => cell.getBoundingClientRect().width);
}

function resizeFromKeyboard(event: KeyboardEvent, handle: HTMLElement) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const table = handle.closest("table");
  const index = Number(handle.dataset.tableColumnResizeIndex);
  if (!table || !Number.isInteger(index)) return;
  const widths = currentWidths(table);
  if (widths[index] === undefined) return;
  event.preventDefault();
  const change = event.key === "ArrowRight" ? 12 : -12;
  widths[index] = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, widths[index] + change));
  const key = storageKey(table);
  applyTableWidths(table, widths, key);
  saveTableWidths(table, widths);
}

function beginPointerResize(event: PointerEvent, handle: HTMLElement) {
  if (event.button !== 0) return;
  const table = handle.closest("table");
  const index = Number(handle.dataset.tableColumnResizeIndex);
  if (!table || !Number.isInteger(index)) return;
  const startingWidths = currentWidths(table);
  if (startingWidths[index] === undefined) return;

  event.preventDefault();
  event.stopPropagation();
  document.body.classList.add("table-column-resizing-active");
  const startX = event.clientX;
  const initialWidth = startingWidths[index];
  const key = storageKey(table);
  let nextWidths = startingWidths;

  const finish = (releaseEvent?: PointerEvent) => {
    if (releaseEvent && releaseEvent.pointerId !== event.pointerId) return;
    document.body.classList.remove("table-column-resizing-active");
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    applyTableWidths(table, nextWidths, key);
    saveTableWidths(table, nextWidths);
  };
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    moveEvent.preventDefault();
    nextWidths = [...startingWidths];
    nextWidths[index] = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, initialWidth + moveEvent.clientX - startX));
    applyTableWidths(table, nextWidths, key);
  };

  window.addEventListener("pointermove", move, { capture: true, passive: false });
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
}

export function TableColumnResizing() {
  useEffect(() => {
    let restoreScheduled = false;
    const scheduleRestore = () => {
      if (restoreScheduled) return;
      restoreScheduled = true;
      window.requestAnimationFrame(() => {
        restoreScheduled = false;
        restoreTableWidths();
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const handle = target.closest<HTMLElement>("[data-table-column-resize-index]");
      if (handle) beginPointerResize(event, handle);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("[data-table-column-resize-index]")) resizeFromKeyboard(event, target);
    };
    const observer = new MutationObserver(scheduleRestore);

    scheduleRestore();
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("popstate", scheduleRestore);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("popstate", scheduleRestore);
    };
  }, []);

  return null;
}
