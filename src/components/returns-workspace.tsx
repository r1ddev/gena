"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, RotateCcw, X } from "lucide-react";
import { findRows, getId, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { OzonSyncButton } from "./ozon-sync-button";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";
import { cycleTableSort, filterAndSortRows, paginateRows, TableEmptyRow, TableHead, TablePagination, TABLE_PAGE_SIZE, type TableColumn, type TableSort } from "./table-controls";
import { ProductArticle } from "./product-hover-card";
import { ConfirmationModal } from "./confirmation-modal";
import { OzonOrderLink } from "./ozon-order-link";
import { OzonReturnLink } from "./ozon-return-link";
import { isOzonWriteOffStatus, ozonReturnStatusLabel } from "@/ozon/return-status";

function returnLabel(row: JsonRecord) {
  if (row.destination === "seller") return "Мне";
  if (row.destination === "ozon") return "На склад Ozon";
  const status = String(row.status ?? "");
  if (status === "WriteOff") return "Списан Ozon";
  const raw = row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw as JsonRecord : {};
  if (String(raw.schema ?? "").toLowerCase() === "fbo") return "На стороне Ozon";
  const target = raw.target_place && typeof raw.target_place === "object" && !Array.isArray(raw.target_place)
    ? raw.target_place as JsonRecord
    : {};
  return String(target.name ?? target.address ?? "—");
}

function returnStatusLabel(row: JsonRecord) {
  if (row.writtenOffAt) return "Товара нет, списан";
  if (row.destination === "seller" && row.receivedBySellerAt) return "Получен";
  const ozonStatus = ozonReturnStatusLabel(row.status, row.raw);
  if (row.destination === "seller" && ozonStatus === "Получен") return "Подтвердите получение";
  return ozonStatus;
}

const returnColumns: TableColumn<JsonRecord>[] = [
  { key: "externalId", label: "Возврат", kind: "identifier", value: (row) => row.externalId ?? row.postingNumber ?? row.id },
  { key: "postingNumber", label: "Отправление", kind: "identifier", value: (row) => row.postingNumber ?? row.orderNumber ?? "" },
  { key: "product", label: "Товар", value: (row) => [row.title ?? row.productName, row.offerId, row.sku, row.ozonSku].filter(Boolean).join(" ") },
  { key: "quantity", label: "Количество", kind: "quantity" },
  { key: "destination", label: "Куда", value: returnLabel },
  { key: "status", label: "Статус", value: (row) => [returnStatusLabel(row), row.profitReconciliationNeeded ? "Прибыль требует сверки" : ""].filter(Boolean).join(" ") },
  { key: "returnedAt", label: "Дата", kind: "date", value: (row) => row.returnedAt ?? row.updatedAt },
  { key: "action", label: "Действие", sortable: false, filterable: false },
];

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function detailDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(date);
}

function detailMoney(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ₽` : "—";
}

function ReturnDetailsDialog({
  row,
  note,
  postingNumber,
  busy,
  noteError,
  linkError,
  onNoteChange,
  onPostingNumberChange,
  onClose,
  onSaveNote,
  onSavePosting,
}: {
  row: JsonRecord;
  note: string;
  postingNumber: string;
  busy: boolean;
  noteError: string;
  linkError: string;
  onNoteChange: (value: string) => void;
  onPostingNumberChange: (value: string) => void;
  onClose: () => void;
  onSaveNote: () => void;
  onSavePosting: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;
  const returnId = String(row.externalId ?? row.id ?? "");
  const linkedPosting = row.linkedPosting && typeof row.linkedPosting === "object" ? row.linkedPosting as JsonRecord : null;
  const linkedItems = records(row.linkedItems);
  const linkedOperations = records(row.linkedOperations);
  const linkedCompensations = records(row.linkedCompensations);
  const article = String(row.offerId ?? "");
  const ozonSku = String(row.ozonSku ?? "");
  const productId = typeof row.productId === "string" ? row.productId : null;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return <div
    className="product-edit-backdrop confirmation-backdrop"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}
  >
    <section ref={dialogRef} className="panel return-details-dialog" role="dialog" aria-modal="true" aria-labelledby="return-details-title" tabIndex={-1}>
      <div className="panel-head"><div><h2 id="return-details-title">Возврат {returnId}</h2><span className="small-note">Подробности возврата и связанные данные</span></div><button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={15} /></button></div>
      <div className="panel-body return-details-body">
        <section className="return-details-section">
          <h3>Возврат</h3>
          <div className="return-details-grid">
            <div><span>Номер в Ozon</span><OzonReturnLink returnId={returnId}>{returnId || "—"}</OzonReturnLink></div>
            <div><span>Статус</span><strong>{ozonReturnStatusLabel(row.status, row.raw)}</strong></div>
            <div><span>Дата</span><strong>{detailDate(row.returnedAt ?? row.updatedAt)}</strong></div>
            <div><span>Куда</span><strong>{returnLabel(row)}</strong></div>
            <div><span>Товар</span><strong>{String(row.title ?? row.productName ?? "Товар не сопоставлен")}</strong></div>
            <div><span>Количество</span><strong>{String(row.quantity ?? "—")}</strong></div>
            <div><span>Артикул</span><strong>{article || "—"}</strong></div>
            <div><span>SKU Ozon</span><strong>{ozonSku || "—"}</strong></div>
          </div>
          {Boolean(row.profitReconciliationNeeded) && <p className="form-help">По этому возврату есть незавершённая сверка денежного итога.</p>}
        </section>

        <section className="return-details-section">
          <h3>Отправление и заказ</h3>
          {linkedPosting ? <>
            <div className="return-details-grid">
              <div><span>Отправление</span><OzonOrderLink postingNumber={String(linkedPosting.externalId ?? "")} /></div>
              <div><span>Номер заказа</span><strong>{String(linkedPosting.orderNumber || "—")}</strong></div>
              <div><span>Статус отправления</span><strong>{String(linkedPosting.status || "—")}</strong></div>
              <div><span>Дата заказа</span><strong>{detailDate(linkedPosting.orderDate)}</strong></div>
            </div>
            <h4>Товары в отправлении</h4>
            {linkedItems.length ? <div className="return-detail-list">{linkedItems.map((item, index) => <div className="return-detail-line" key={`${String(item.ozonSku)}-${index}`}>
              <div><strong>{String(item.title || "Товар")}</strong><span>Артикул: {String(item.article || "—")} · SKU Ozon: {String(item.ozonSku || "—")}</span></div>
              <div className="return-detail-line-value">{String(item.quantity ?? "—")} шт. · {detailMoney(item.price)}</div>
            </div>)}</div> : <p className="form-help">Состав отправления в сохранённых данных не найден.</p>}
          </> : <p className="form-help">Отправление с возвратом пока не связано. Укажи его номер ниже.</p>}
        </section>

        <section className="return-details-section">
          <h3>Операции по отправлению</h3>
          {linkedOperations.length ? <div className="return-detail-list">{linkedOperations.map((operation, index) => <div className="return-detail-line" key={`${String(operation.date)}-${String(operation.typeId)}-${index}`}>
            <div><strong>{String(operation.label || "Операция Ozon")}</strong><span>{detailDate(operation.date)}{operation.typeId ? ` · код ${String(operation.typeId)}` : ""}</span></div>
            <div className="return-detail-line-value">{detailMoney(operation.amount)}</div>
          </div>)}</div> : <p className="form-help">Связанные операции Ozon не найдены.</p>}
        </section>

        <section className="return-details-section">
          <h3>Списания и компенсации Ozon</h3>
          {linkedCompensations.length ? <>
            <p className="form-help">Начисления связаны с отправлением, списания товара — с отправлением и SKU. Если в отправлении несколько возвратов, Ozon не указывает, к какому из них относится сумма.</p>
            <div className="return-detail-list">{linkedCompensations.map((compensation) => <div className="return-detail-line" key={String(compensation.id)}>
              <div><strong>{String(compensation.status || compensation.origin || "Списание Ozon")}</strong><span>{String(compensation.origin || "Ozon")} · {String(compensation.matchBasis || "связано с отправлением")} · {detailDate(compensation.date)}{compensation.ozonSku ? ` · SKU Ozon ${String(compensation.ozonSku)}` : ""}{compensation.quantity ? ` · ${String(compensation.quantity)} шт.` : ""}</span></div>
              <div className="return-detail-line-value">{detailMoney(compensation.amount)}</div>
            </div>)}</div>
          </> : <p className="form-help">Совпадающих записей списаний или компенсаций не найдено.</p>}
        </section>

        <section className="return-details-section">
          <h3>Связать с отправлением</h3>
          {linkError && <div className="error-banner" role="alert"><AlertCircle size={15} />{linkError}</div>}
          <div className="return-link-form"><input aria-label="Номер отправления Ozon" placeholder="Номер отправления Ozon" value={postingNumber} disabled={busy} onChange={(event) => onPostingNumberChange(event.target.value)} /><button type="button" className="button secondary" disabled={busy || !postingNumber.trim()} onClick={onSavePosting}>{busy ? "Сохраняем…" : linkedPosting ? "Сохранить связь" : "Связать"}</button></div>
        </section>

        <section className="return-details-section">
          <h3>Комментарий</h3>
          {noteError && <div className="error-banner" role="alert"><AlertCircle size={15} />{noteError}</div>}
          <form onSubmit={(event) => { event.preventDefault(); onSaveNote(); }}>
            <div className="field"><label htmlFor="return-note">Заметка к возврату</label><textarea ref={textareaRef} id="return-note" rows={3} maxLength={2000} value={note} disabled={busy} onChange={(event) => onNoteChange(event.target.value)} placeholder="Напишите заметку для себя" /></div>
            <p className="form-help">Комментарий хранится в приложении и не отправляется в Ozon.</p>
            <div className="form-actions"><button type="submit" className="button" disabled={busy || note.trim() === String(row.note ?? "").trim()}>{busy ? "Сохраняем…" : "Сохранить комментарий"}</button></div>
          </form>
        </section>
      </div>
    </section>
  </div>;
}

export function ReturnsWorkspace() {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState("");
  const [pendingWriteoff, setPendingWriteoff] = useState<JsonRecord | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<JsonRecord | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState("");
  const [postingDraft, setPostingDraft] = useState("");
  const [linkError, setLinkError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<TableSort>(null);
  const [page, setPage] = useState(1);

  const visibleRows = useMemo(() => filterAndSortRows(rows, returnColumns, filters, sort), [rows, filters, sort]);
  const localPagination = useMemo(() => paginateRows(visibleRows, page), [visibleRows, page]);
  const hasActiveFilters = Object.values(filters).some((value) => value.trim());

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function updateSort(key: string) {
    setSort((current) => cycleTableSort(current, key));
    setPage(1);
  }

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const nextRows = findRows(await requestJson("/api/returns")).filter((row) =>
        row.destination !== "ozon"
        && !row.receivedBySellerAt
        && !row.writtenOffAt
        && !isOzonWriteOffStatus(row.status, row.raw)
      );
      setRows(nextRows);
      return nextRows;
    }
    catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить возвраты"); return []; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const refreshAfterSync = () => { void refresh(); };
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
    return () => window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, refreshAfterSync);
  }, [refresh]);

  async function markReceived(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    setBusyId(id); setError(""); setSuccess("");
    const today = new Date().toISOString();
    try {
      await requestJson(`/api/returns?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ destination: "seller", receivedBySellerAt: today }) });
      setSuccess("Получение записано. Товар добавлен на ваш склад.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить возврат"); }
    finally { setBusyId(""); }
  }

  async function markWrittenOff(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    setBusyId(id); setError(""); setSuccess("");
    try {
      await requestJson(`/api/returns?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ writeoff: true }) });
      setPendingWriteoff(null);
      setSuccess("Списание записано. Остатки обновлены.");
      await refresh();
    } catch (reason) { setPendingWriteoff(null); setError(reason instanceof Error ? reason.message : "Не удалось списать товар"); }
    finally { setBusyId(""); }
  }

  function openDetails(row: JsonRecord) {
    setSelectedReturn(row);
    setNoteDraft(String(row.note ?? ""));
    setNoteError("");
    setPostingDraft(String(row.postingNumber ?? ""));
    setLinkError("");
  }

  async function linkPosting(row: JsonRecord) {
    const id = getId(row); if (!id) return;
    const postingNumber = postingDraft.trim();
    if (!postingNumber) { setLinkError("Укажи номер отправления Ozon."); return; }
    setBusyId(id); setError(""); setSuccess("");
    try {
      await requestJson(`/api/returns?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ postingNumber }) });
      const refreshedRows = await refresh();
      const refreshedReturn = refreshedRows.find((item) => getId(item) === id);
      if (refreshedReturn) setSelectedReturn(refreshedReturn);
      setPostingDraft(postingNumber);
      setLinkError("");
      setSuccess("Возврат связан с отправлением. Денежный итог по заказу обновлён.");
    } catch (reason) { setLinkError(reason instanceof Error ? reason.message : "Не удалось связать возврат с отправлением"); }
    finally { setBusyId(""); }
  }

  async function saveNote() {
    if (!selectedReturn) return;
    const id = getId(selectedReturn);
    if (!id) return;
    setBusyId(id); setNoteError("");
    try {
      await requestJson(`/api/returns?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ note: noteDraft }) });
      setRows((current) => current.map((row) => getId(row) === id ? { ...row, note: noteDraft } : row));
      setSelectedReturn((current) => current && getId(current) === id ? { ...current, note: noteDraft } : current);
      setSuccess("Комментарий к возврату сохранён.");
    } catch (reason) {
      setNoteError(reason instanceof Error ? reason.message : "Не удалось сохранить комментарий");
    } finally { setBusyId(""); }
  }

  return <>
    <PageHeader eyebrow="Обработка возвратов" title="Возвраты" description="Нажмите на строку, чтобы открыть детали, изменить связь с отправлением или добавить комментарий. Быстрые действия — «Получил» и «Списать»." actions={<OzonSyncButton kind="returns" label="Синхронизировать возвраты" completedMessage="Возвраты и связанные с ними статусы и суммы обновлены." />} />
    {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}{success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}
    <section className="panel">
      <div className="panel-head"><div><h2>Возвраты, требующие действия</h2><span className="small-note">{loading ? "Загружаем возвраты…" : visibleRows.length === rows.length ? `${rows.length} записей` : `${visibleRows.length} из ${rows.length} записей`}</span></div><RotateCcw size={17} color="#178b63" /></div>
      {loading && rows.length === 0 && !hasActiveFilters ? <div className="panel-body"><div className="loading-line" /></div> : loadError && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><AlertCircle size={18} /></div><div className="empty-title">Не удалось загрузить возвраты</div><p className="empty-description">{loadError}</p><button className="button secondary" style={{ marginTop: 12 }} onClick={() => void refresh()}>Повторить</button></div></div> : rows.length === 0 && !hasActiveFilters ? <div className="empty-state"><div><div className="empty-icon"><RotateCcw size={18} /></div><div className="empty-title">Возвратов, требующих действия, пока нет</div><p className="empty-description">Здесь появятся возвраты, которые нужно получить или проверить.</p></div></div> : <div className="table-wrap"><table><TableHead columns={returnColumns} rows={rows} filters={filters} onFilter={updateFilter} sort={sort} onSort={updateSort} /><tbody>{loadError ? <TableEmptyRow colSpan={returnColumns.length} message={loadError} /> : loading && hasActiveFilters ? <TableEmptyRow colSpan={returnColumns.length} message="Обновляем список…" /> : visibleRows.length === 0 ? <TableEmptyRow colSpan={returnColumns.length} message="По заданным условиям совпадений нет." onClear={() => { setFilters({}); setPage(1); }} /> : localPagination.rows.map((row, index) => {
        const id = getId(row) ?? String(index); const destination = row.destination;
        const writtenOff = Boolean(row.writtenOffAt);
        const sellerDone = destination === "seller" && Boolean(row.receivedBySellerAt) && !writtenOff;
        const postingNumber = String(row.postingNumber ?? "");
        const postingMatched = row.postingMatched === true;
        const profitNeedsReconciliation = row.profitReconciliationNeeded === true || (!postingMatched && sellerDone);
        const returnId = String(row.externalId ?? "");
        const sellerArticle = String(row.offerId || "");
        const ozonSku = String(row.ozonSku || "");
        const productId = typeof row.productId === "string" ? row.productId : null;
        return <tr key={id} tabIndex={0} aria-haspopup="dialog" aria-label={`Открыть подробности возврата ${returnId || postingNumber || id}`} onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a, button, input, textarea, select, [role='button']")) return;
          openDetails(row);
        }} onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
            event.preventDefault();
            openDetails(row);
          }
        }}>
          <td className="table-primary"><OzonReturnLink returnId={returnId}>{returnId || String(row.postingNumber ?? id)}</OzonReturnLink></td>
          <td>{postingNumber ? <OzonOrderLink postingNumber={postingNumber} /> : "—"}</td>
          <td>
            <span className="table-primary">{String(row.title ?? row.productName ?? "—")}</span>
            {sellerArticle && <span className="table-secondary">Артикул: <ProductArticle identifier={sellerArticle} productId={productId} identifierLabel="Артикул" fallback={row} /></span>}
            {ozonSku && <span className="table-secondary">SKU Ozon: <ProductArticle identifier={ozonSku} productId={productId} identifierLabel="SKU Ozon" fallback={row} /></span>}
          </td>
          <td className="number">{String(row.quantity ?? "—")}</td>
          <td>{returnLabel(row)}</td>
          <td><span className={`badge ${writtenOff ? "orange" : sellerDone ? "green" : "orange"}`}>{returnStatusLabel(row)}</span>{profitNeedsReconciliation && <span className="badge orange" style={{ marginTop: 5 }}>Прибыль требует сверки</span>}</td>
          <td>{String(row.returnedAt ?? row.updatedAt ?? "—").slice(0, 10)}</td>
          <td><div className="row-actions">{!sellerDone && !writtenOff && <button className="button secondary small" disabled={busyId === id} onClick={() => void markReceived(row)}>Получил</button>}{!writtenOff && <button className="button danger small" disabled={busyId === id || !productId} title={!productId ? "Сначала сопоставьте товар с каталогом" : undefined} onClick={() => setPendingWriteoff(row)}>Списать</button>}</div></td>
        </tr>;
      })}</tbody></table></div>}
      <TablePagination page={localPagination.page} pageSize={TABLE_PAGE_SIZE} total={visibleRows.length} label="Возвраты" busy={loading} onPageChange={setPage} />
    </section>
    <ConfirmationModal
      open={pendingWriteoff !== null}
      title="Списать товар из возврата?"
      description="Товар не попадёт в остатки. Его закупочная стоимость и добавочная стоимость будут учтены как потеря."
      confirmLabel="Списать товар"
      busy={Boolean(busyId)}
      onCancel={() => setPendingWriteoff(null)}
      onConfirm={() => { if (pendingWriteoff) void markWrittenOff(pendingWriteoff); }}
    />
    {selectedReturn && <ReturnDetailsDialog
      row={selectedReturn}
      note={noteDraft}
      postingNumber={postingDraft}
      busy={busyId === getId(selectedReturn)}
      noteError={noteError}
      linkError={linkError}
      onNoteChange={setNoteDraft}
      onPostingNumberChange={(value) => { setPostingDraft(value); setLinkError(""); }}
      onClose={() => { if (!busyId) setSelectedReturn(null); }}
      onSaveNote={() => void saveNote()}
      onSavePosting={() => void linkPosting(selectedReturn)}
    />}
  </>;
}
