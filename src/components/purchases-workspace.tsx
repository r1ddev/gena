"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, PackageCheck, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { asRecord, findRows, getId, localToday, requestJson, stringValue, type JsonRecord } from "./api";
import { ResourcePage } from "./resource-page";
import { ProductArticle } from "./product-hover-card";
import { cycleTableSort, filterAndSortRows, TableEmptyRow, TableHead, type TableColumn, type TableSort } from "./table-controls";

function formatPurchaseQuantity(value: unknown): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(number) : "0";
}

function formatPurchaseAmount(value: unknown): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : "0,00";
}

function formatPurchaseDate(value: unknown): string {
  if (typeof value !== "string") return "Дата не указана";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function normalizePurchaseSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

function purchaseSearchText(purchase: JsonRecord): string {
  const date = typeof purchase.purchasedAt === "string" ? purchase.purchasedAt : "";
  const localizedValues = [
    formatPurchaseDate(date),
    formatPurchaseQuantity(purchase.orderedQuantity),
    formatPurchaseQuantity(purchase.receivedQuantity),
    formatPurchaseQuantity(purchase.expectedQuantity),
    formatPurchaseAmount(purchase.amountPaid),
  ].join(" ");
  return normalizePurchaseSearch(`${JSON.stringify(purchase)} ${localizedValues}`);
}

function purchaseSummary(purchase: JsonRecord): string {
  const article = typeof purchase.sku === "string" && purchase.sku ? purchase.sku : "Артикул не указан";
  return `${article} · ${formatPurchaseDate(purchase.purchasedAt)} · ожидается ${formatPurchaseQuantity(purchase.expectedQuantity)} шт.`;
}

function PurchasePicker({
  purchases,
  selectedId,
  onSelect,
}: {
  purchases: JsonRecord[];
  selectedId: string;
  onSelect: (purchase: JsonRecord | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = purchases.find((purchase) => getId(purchase) === selectedId);
  const normalizedQuery = normalizePurchaseSearch(query);
  const matches = purchases.filter((purchase) => !normalizedQuery || purchaseSearchText(purchase).includes(normalizedQuery));
  const activePurchase = activeIndex >= 0 ? matches[activeIndex] : undefined;

  function choose(purchase: JsonRecord) {
    onSelect(purchase);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  }

  return <div className="field wide purchase-picker-field">
    <label htmlFor="purchase-id">Закупка *</label>
    <div className="purchase-picker">
      <div className="purchase-picker-input-wrap">
        <Search size={15} aria-hidden="true" />
        <input
          id="purchase-id"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="purchase-options"
          aria-activedescendant={activePurchase && getId(activePurchase) ? `purchase-option-${getId(activePurchase)}` : undefined}
          autoComplete="off"
          required
          value={open ? query : selected ? purchaseSummary(selected) : query}
          placeholder="Артикул, комментарий, количество, сумма или дата"
          onFocus={() => { setOpen(true); setQuery(""); setActiveIndex(-1); }}
          onBlur={() => { setOpen(false); setQuery(""); setActiveIndex(-1); }}
          onChange={(event) => { onSelect(null); setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && matches.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(current + 1, matches.length - 1));
            } else if (event.key === "ArrowUp" && matches.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => current <= 0 ? matches.length - 1 : current - 1);
            } else if (event.key === "Enter" && open && matches.length > 0) {
              event.preventDefault();
              choose(matches[activeIndex >= 0 ? activeIndex : 0]);
            } else if (event.key === "Escape") {
              setOpen(false); setQuery(""); setActiveIndex(-1);
            }
          }}
        />
      </div>
      {open && <div id="purchase-options" className="purchase-picker-options" role="listbox" aria-label="Найденные закупки">
        {matches.length === 0 ? <div className="purchase-picker-empty">Закупки не найдены</div> : matches.map((purchase, index) => {
          const id = getId(purchase);
          if (!id) return null;
          const article = typeof purchase.sku === "string" && purchase.sku ? purchase.sku : "Артикул не указан";
          const note = typeof purchase.note === "string" ? purchase.note.trim() : "";
          return <div
            id={`purchase-option-${id}`}
            key={id}
            className={`purchase-picker-option ${index === activeIndex ? "active" : ""} ${id === selectedId ? "selected" : ""}`}
            role="option"
            aria-selected={id === selectedId}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(purchase)}
          >
            <span className="purchase-picker-option-title">Артикул <ProductArticle identifier={article} productId={typeof purchase.productId === "string" ? purchase.productId : null} fallback={purchase} stopClickPropagation /></span>
            <span className="purchase-picker-option-details">
              {formatPurchaseDate(purchase.purchasedAt)} · заказано {formatPurchaseQuantity(purchase.orderedQuantity)} · принято {formatPurchaseQuantity(purchase.receivedQuantity)} · ожидается {formatPurchaseQuantity(purchase.expectedQuantity)} шт. · оплачено {formatPurchaseAmount(purchase.amountPaid)} ₽
            </span>
            {note && <span className="purchase-picker-option-comment">{note}</span>}
          </div>;
        })}
      </div>}
    </div>
  </div>;
}

export function PurchasesWorkspace() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [purchases, setPurchases] = useState<JsonRecord[]>([]);
  const [products, setProducts] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [receivedAt, setReceivedAt] = useState(localToday());
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>([]);
  const [note, setNote] = useState("");
  const [editingReceiptId, setEditingReceiptId] = useState("");
  const [historyFilters, setHistoryFilters] = useState<Record<string, string>>({});
  const [historySort, setHistorySort] = useState<TableSort>(null);
  const catalog = products.filter((product) => typeof product.id === "string");

  const refreshPurchases = useCallback(async () => {
    const [purchaseResult, productResult] = await Promise.allSettled([requestJson("/api/purchases"), requestJson("/api/products")]);
    if (purchaseResult.status === "fulfilled") setPurchases(findRows(purchaseResult.value));
    else setPurchases([]);
    if (productResult.status === "fulfilled") setProducts(findRows(productResult.value));
    else setProducts([]);
  }, []);
  useEffect(() => { void refreshPurchases(); }, [refreshPurchases, refreshKey]);

  const selectedPurchase = purchases.find((purchase) => getId(purchase) === selectedId) ?? null;
  const receiptRows: JsonRecord[] = purchases.flatMap<JsonRecord>((purchase) => {
    if (!Array.isArray(purchase.receipts)) return [];
    return purchase.receipts.flatMap<JsonRecord>((value) => {
      const receipt = asRecord(value);
      const receiptId = receipt ? getId(receipt) : null;
      if (!receipt || !receiptId) return [];
      const receiptLines = Array.isArray(receipt.lines) ? receipt.lines.map(asRecord).filter((line): line is JsonRecord => line !== null) : [];
      const totalQuantity = receiptLines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
      return [{
        ...receipt,
        id: receiptId,
        purchaseId: getId(purchase) ?? "",
        purchaseSku: typeof purchase.sku === "string" ? purchase.sku : "",
        purchaseProductId: typeof purchase.productId === "string" ? purchase.productId : null,
        purchaseDate: purchase.purchasedAt,
        actualLines: receiptLines,
        actualArticles: receiptLines.map((line) => stringValue(line.sku) ?? "").join(" "),
        totalQuantity,
      }];
    });
  });
  const historyColumns: TableColumn<JsonRecord>[] = [
    { key: "receivedAt", label: "Дата", kind: "date", filterable: false },
    { key: "purchaseSku", label: "Закупка", kind: "identifier" },
    { key: "actualArticles", label: "Что приехало", kind: "text", value: (row) => row.actualArticles },
    { key: "totalQuantity", label: "Количество", kind: "quantity" },
    { key: "note", label: "Комментарий", kind: "text" },
  ];
  const visibleReceiptRows = filterAndSortRows(receiptRows, historyColumns, historyFilters, historySort);

  function resetReceiptForm() {
    setEditingReceiptId(""); setSelectedId(""); setLines([]); setNote(""); setReceivedAt(localToday());
  }

  async function submitReceipt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !selectedPurchase) {
      setError("Выберите закупку из списка.");
      return;
    }
    if (lines.length === 0 || lines.some((line) => !line.productId || !line.quantity || Number(line.quantity) <= 0)) {
      setError("Укажите фактически полученные товары и их количество.");
      return;
    }
    setBusy(true); setError(""); setSuccess("");
    try {
      const body = { ...(editingReceiptId ? {} : { purchaseId: selectedId }), receivedAt, lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })), note };
      await requestJson(editingReceiptId ? `/api/purchases/receipts?id=${encodeURIComponent(editingReceiptId)}` : "/api/purchases/receipts", { method: editingReceiptId ? "PATCH" : "POST", body: JSON.stringify(body) });
      resetReceiptForm(); setSuccess(editingReceiptId ? "Приёмка изменена." : "Приёмка записана."); setRefreshKey((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось записать приёмку"); }
    finally { setBusy(false); }
  }

  function editReceipt(receipt: JsonRecord) {
    const receiptId = getId(receipt);
    if (!receiptId) return;
    setEditingReceiptId(receiptId);
    setSelectedId(typeof receipt.purchaseId === "string" ? receipt.purchaseId : "");
    setReceivedAt(typeof receipt.receivedAt === "string" ? receipt.receivedAt.slice(0, 10) : localToday());
    setNote(typeof receipt.note === "string" ? receipt.note : "");
    const receiptLines = Array.isArray(receipt.actualLines) ? receipt.actualLines.map(asRecord).filter((line): line is JsonRecord => line !== null) : [];
    setLines(receiptLines.map((line) => ({ productId: typeof line.productId === "string" ? line.productId : "", quantity: String(line.quantity ?? "") })));
    setError(""); setSuccess("");
    document.getElementById("receipt-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function deleteReceipt(receipt: JsonRecord) {
    const id = getId(receipt);
    if (!id || !window.confirm("Удалить эту приёмку? Остаток и себестоимость пересчитаются без неё.")) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson(`/api/purchases/receipts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (editingReceiptId === id) resetReceiptForm();
      setSuccess("Приёмка удалена."); setRefreshKey((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить приёмку"); }
    finally { setBusy(false); }
  }

  async function togglePurchaseStatus(purchase: JsonRecord) {
    const id = getId(purchase);
    if (!id) return;
    const nextStatus = purchase.status === "completed" ? "open" : "completed";
    setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson(`/api/purchases?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      setSuccess(nextStatus === "completed" ? "Закупка завершена. Себестоимость пересчитана по фактическим приёмкам." : "Закупка возобновлена. Её приёмки исключены из средней себестоимости.");
      setRefreshKey((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить статус закупки"); }
    finally { setBusy(false); }
  }

  return <>
    {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}
    {success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}
    <ResourcePage refreshKey={refreshKey} onMutation={() => setRefreshKey((value) => value + 1)} config={{
      title: "Закупки", eyebrow: "Товары и себестоимость",
      description: "Закупка уменьшает расчётный денежный баланс сразу. Принятый товар сразу попадает на склад, но влияет на среднюю себестоимость только после завершения закупки.",
      collectionUrl: "/api/purchases", createUrl: "/api/purchases", createLabel: "Новая закупка",
      fields: [
        { name: "productId", label: "Товар *", type: "select", optionsFrom: "/api/products", required: true },
        { name: "purchasedAt", label: "Дата закупки *", type: "date", required: true },
        { name: "orderedQuantity", label: "Заказано, шт. *", type: "number", step: "0.001", min: "0.001", required: true },
        { name: "amountPaid", label: "Оплачено, ₽ *", type: "number", step: "0.01", required: true },
        { name: "note", label: "Комментарий", type: "textarea", wide: true },
      ],
      columns: [
        { key: "purchasedAt", label: "Дата", kind: "date" }, { key: "title", label: "Товар", primary: true }, { key: "sku", label: "Артикул" },
        { key: "orderedQuantity", label: "Заказано", kind: "quantity" }, { key: "receivedQuantity", label: "Принято", kind: "quantity" },
        { key: "expectedQuantity", label: "Ожидается", kind: "quantity" }, { key: "amountPaid", label: "Оплачено", kind: "money" }, { key: "receiptStatus", label: "Приёмка", kind: "status" }, { key: "note", label: "Комментарий" },
      ],
      deleteUrl: (row) => typeof row.id === "string" ? `/api/purchases?id=${encodeURIComponent(row.id)}` : null,
      emptyTitle: "Закупок пока нет", emptyDescription: "Создайте закупку. Приёмка сразу добавит товар на склад, а средняя себестоимость начнёт учитывать её после завершения закупки.",
    }} rowActions={(row) => {
      const completed = row.status === "completed";
      return <button type="button" className="button secondary small" disabled={busy} aria-label={`${completed ? "Возобновить" : "Завершить"} закупку`} onClick={() => void togglePurchaseStatus(row)}>{completed ? <><RotateCcw size={14} /> Возобновить</> : <><CheckCircle2 size={14} /> Завершить закупку</>}</button>;
    }} />

    <section className="panel" id="receipt-form" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>{editingReceiptId ? "Изменить приёмку" : "Приёмка закупки"}</h2><PackageCheck size={17} color="#178b63" /></div>
      <form className="panel-body" onSubmit={submitReceipt}>
        <div className="form-grid">
          {editingReceiptId ? <div className="field wide"><label>Закупка</label><div className="receipt-purchase-readonly">{selectedPurchase ? <><ProductArticle identifier={String(selectedPurchase.sku ?? "Артикул не указан")} productId={String(selectedPurchase.productId ?? "")} fallback={selectedPurchase} /> · {formatPurchaseDate(selectedPurchase.purchasedAt)} · оплачено {formatPurchaseAmount(selectedPurchase.amountPaid)} ₽</> : "Закупка"}</div></div> : <PurchasePicker purchases={purchases} selectedId={selectedId} onSelect={(purchase) => {
            if (!purchase) { setSelectedId(""); setLines([]); return; }
            const id = getId(purchase);
            const expectedQuantity = Number(purchase.expectedQuantity);
            setSelectedId(id ?? "");
            setLines([{ productId: String(purchase.productId ?? ""), quantity: Number.isFinite(expectedQuantity) && expectedQuantity > 0 ? String(expectedQuantity) : "" }]);
          }} />}
          <div className="field"><label htmlFor="receipt-date">Дата приёмки *</label><input id="receipt-date" type="date" required value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></div>
          <div className="field wide"><label htmlFor="receipt-note">Комментарий</label><input id="receipt-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <div className="receipt-lines-editor">
          <div className="receipt-lines-title"><strong>Фактически приехало</strong><button type="button" className="button secondary small" onClick={() => setLines((current) => [...current, { productId: "", quantity: "" }])}><Plus size={14} /> Добавить товар</button></div>
          {lines.map((line, index) => <div className="receipt-line-editor" key={`${editingReceiptId || selectedId}-${index}`}>
            <div className="field"><label htmlFor={`receipt-product-${index}`}>Товар *</label><select id={`receipt-product-${index}`} required value={line.productId} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item))}>
              <option value="">Выберите артикул…</option>{catalog.map((product) => <option key={String(product.id)} value={String(product.id)}>{String(product.sku ?? "Артикул не указан")} · {String(product.title ?? "Товар")}</option>)}
            </select></div>
            <div className="field"><label htmlFor={`receipt-quantity-${index}`}>Количество, шт. *</label><input id={`receipt-quantity-${index}`} type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></div>
            <button type="button" className="icon-button receipt-line-remove" aria-label="Убрать товар из приёмки" disabled={lines.length <= 1} onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>
          </div>)}
          <p className="form-help">Приёмка сразу меняет остаток. Средняя себестоимость начнёт учитывать закупку только после завершения и рассчитается по всему фактически принятому количеству.</p>
        </div>
        <div className="form-actions">
          {editingReceiptId && <button type="button" className="button secondary" disabled={busy} onClick={resetReceiptForm}>Отмена</button>}
          <button className="button" disabled={busy || purchases.length === 0 || catalog.length === 0}>{busy ? "Сохраняем…" : editingReceiptId ? "Сохранить приёмку" : "Записать приёмку"}</button>
        </div>
        {purchases.length === 0 && <p className="form-help">Сначала добавьте закупку.</p>}
        {catalog.length === 0 && <p className="form-help">Сначала добавьте товары в каталог.</p>}
      </form>
    </section>

    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>История приёмок</h2><span className="small-note">{receiptRows.length} записей</span></div>
      <div className="table-wrap"><table>
        <TableHead columns={historyColumns} filters={historyFilters} onFilter={(key, value) => setHistoryFilters((current) => ({ ...current, [key]: value }))} sort={historySort} onSort={(key) => setHistorySort((current) => cycleTableSort(current, key))} trailingHeaders={["Действия"]} />
        <tbody>{visibleReceiptRows.length === 0 ? <TableEmptyRow colSpan={6} message={receiptRows.length === 0 ? "Приёмок пока нет." : "По фильтрам ничего не найдено."} onClear={Object.values(historyFilters).some(Boolean) ? () => setHistoryFilters({}) : undefined} /> : visibleReceiptRows.map((receipt) => <tr key={String(receipt.id)}>
          <td className="number">{formatPurchaseDate(receipt.receivedAt)}</td>
          <td><ProductArticle identifier={String(receipt.purchaseSku || "Артикул не указан")} productId={typeof receipt.purchaseProductId === "string" ? receipt.purchaseProductId : null} fallback={receipt} /></td>
          <td><div className="supply-article-list">{(Array.isArray(receipt.actualLines) ? receipt.actualLines : []).map((value, index) => { const line = asRecord(value); if (!line) return null; return <span className="supply-article-chip" key={String(line.id ?? index)}><ProductArticle identifier={String(line.sku || "Артикул не указан")} productId={typeof line.productId === "string" ? line.productId : null} fallback={line} /><strong>× {formatPurchaseQuantity(line.quantity)}</strong></span>; })}</div></td>
          <td className="number">{formatPurchaseQuantity(receipt.totalQuantity)}</td>
          <td>{String(receipt.note ?? "") || "—"}</td>
          <td><div className="row-actions"><button type="button" className="icon-button" aria-label="Изменить приёмку" onClick={() => editReceipt(receipt)}><Pencil size={14} /></button><button type="button" className="icon-button danger" aria-label="Удалить приёмку" disabled={busy} onClick={() => void deleteReceipt(receipt)}><Trash2 size={14} /></button></div></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </>;
}
