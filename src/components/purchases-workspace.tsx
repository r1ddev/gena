"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, PackageCheck, Search } from "lucide-react";
import { findRows, getId, localToday, requestJson, type JsonRecord } from "./api";
import { ResourcePage } from "./resource-page";
import { ProductArticle } from "./product-hover-card";

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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [receivedAt, setReceivedAt] = useState(localToday());
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const receivablePurchases = purchases.filter((purchase) => Number(purchase.expectedQuantity) > 0);

  const refreshPurchases = useCallback(async () => {
    try { setPurchases(findRows(await requestJson("/api/purchases"))); }
    catch { setPurchases([]); }
  }, []);
  useEffect(() => { void refreshPurchases(); }, [refreshPurchases, refreshKey]);

  async function submitReceipt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !receivablePurchases.some((purchase) => getId(purchase) === selectedId)) {
      setError("Выберите закупку из списка.");
      return;
    }
    setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson("/api/purchases/receipts", { method: "POST", body: JSON.stringify({ purchaseId: selectedId, receivedAt, receivedQuantity: Number(quantity), note }) });
      setSelectedId(""); setQuantity(""); setNote(""); setSuccess("Приёмка записана. Остаток и средняя себестоимость обновлены."); setRefreshKey((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось записать приёмку"); }
    finally { setBusy(false); }
  }

  return <>
    <ResourcePage refreshKey={refreshKey} onMutation={() => setRefreshKey((value) => value + 1)} config={{
      title: "Закупки", eyebrow: "Товары и себестоимость",
      description: "Закупка уменьшает расчётный денежный баланс сразу. В остаток и среднюю закупочную цену входит только фактически принятое количество.",
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
        { key: "expectedQuantity", label: "Ожидается", kind: "quantity" }, { key: "amountPaid", label: "Оплачено", kind: "money" }, { key: "note", label: "Комментарий" },
      ],
      deleteUrl: (row) => typeof row.id === "string" ? `/api/purchases?id=${encodeURIComponent(row.id)}` : null,
      emptyTitle: "Закупок пока нет", emptyDescription: "Создайте закупку. Неполученное количество будет видно отдельно и не повлияет на остаток или среднюю себестоимость.",
    }} />

    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>Приёмка закупки</h2><PackageCheck size={17} color="#178b63" /></div>
      {error && <div className="error-banner" role="alert" style={{ margin: "13px 18px 0" }}><AlertCircle size={15} />{error}</div>}
      {success && <div className="success-banner" role="status" style={{ margin: "13px 18px 0" }}><CheckCircle2 size={15} />{success}</div>}
      <form className="panel-body" onSubmit={submitReceipt}>
        <div className="form-grid">
          <PurchasePicker purchases={receivablePurchases} selectedId={selectedId} onSelect={(purchase) => {
            if (!purchase) { setSelectedId(""); setQuantity(""); return; }
            const id = getId(purchase);
            const expectedQuantity = Number(purchase.expectedQuantity);
            setSelectedId(id ?? "");
            setQuantity(Number.isFinite(expectedQuantity) && expectedQuantity > 0 ? String(expectedQuantity) : "");
          }} />
          <div className="field"><label htmlFor="receipt-date">Дата приёмки *</label><input id="receipt-date" type="date" required value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></div>
          <div className="field"><label htmlFor="receipt-quantity">Принято, шт. *</label><input id="receipt-quantity" type="number" min="0.001" step="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
          <div className="field wide"><label htmlFor="receipt-note">Комментарий</label><input id="receipt-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <div className="form-actions"><button className="button" disabled={busy || receivablePurchases.length === 0}>{busy ? "Сохраняем…" : "Записать приёмку"}</button></div>
        {receivablePurchases.length === 0 && <p className="form-help">Нет закупок с ожидаемым количеством.</p>}
      </form>
    </section>
  </>;
}
