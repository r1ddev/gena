"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Barcode, CheckCircle2, Download, Pencil, Plus, Trash2, Truck, X } from "lucide-react";
import { asRecord, getId, localToday, requestJson, type JsonRecord } from "./api";
import { ResourcePage } from "./resource-page";
import { ProductSelect, productFallbackOption, productSelectOptions, type ProductSelectOption } from "./product-select";
import { OZON_SYNC_COMPLETED_EVENT } from "./ozon-sync-events";

type SupplyEditLine = { productId: string; quantity: string; sku: string; title: string };
const supplyMarketplaceOptions = [
  { value: "ozon", label: "Ozon" },
  { value: "wb", label: "WB" },
  { value: "avito", label: "Авито" },
  { value: "other", label: "Другая площадка" },
  { value: "unknown", label: "Не указана" },
];

function productOptions(value: unknown): ProductSelectOption[] { return productSelectOptions(value); }

function SupplyEntryForm({ products, onSaved }: { products: ProductSelectOption[]; onSaved: () => void }) {
  const [lines, setLines] = useState([{ productId: "", quantity: "" }]);
  const [suppliedAt, setSuppliedAt] = useState(localToday());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson("/api/supplies", { method: "POST", body: JSON.stringify({ suppliedAt, note, lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })) }) });
      setLines([{ productId: "", quantity: "" }]); setNote(""); setSuccess("Поставка создана: товар перемещён на склад Ozon."); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать поставку"); }
    finally { setBusy(false); }
  }

  return <section className="panel form-panel">
    <div className="panel-head"><div><h2>Новая поставка</h2><span className="small-note">После создания товар сразу перемещается на склад Ozon</span></div><Truck size={17} color="#178b63" /></div>
    <form className="panel-body" onSubmit={submit}>
      {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}
      {success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}
      <div className="form-grid">
        <div className="field"><label htmlFor="supply-date">Дата поставки *</label><input id="supply-date" type="date" required value={suppliedAt} onChange={(event) => setSuppliedAt(event.target.value)} /></div>
        <div className="field wide"><label htmlFor="supply-note">Комментарий</label><input id="supply-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Номер заявки или заметка" /></div>
      </div>
      <div className="form-help" style={{ marginBottom: 8, color: "#5f6d64", fontWeight: 700 }}>Состав поставки</div>
      <p className="form-help">Закупочная стоимость и себестоимость с добавочной фиксируются автоматически на момент создания.</p>
      <div className="line-items">{lines.map((line, index) => <div className="line-item" key={index}>
        <div className="field"><label htmlFor={`supply-product-${index}`}>Товар *</label><ProductSelect id={`supply-product-${index}`} required value={line.productId} products={products} placeholder="Выберите товар…" onChange={(productId) => setLines((current) => current.map((item, row) => row === index ? { ...item, productId } : item))} /></div>
        <div className="field"><label htmlFor={`supply-quantity-${index}`}>Количество, шт. *</label><input id={`supply-quantity-${index}`} type="number" min="1" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} /></div>
        <button type="button" className="icon-button" aria-label="Удалить товар из поставки" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><Trash2 size={14} /></button>
      </div>)}</div>
      <div className="form-actions" style={{ justifyContent: "space-between" }}><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, { productId: "", quantity: "" }])}><Plus size={14} />Добавить товар</button><button className="button" disabled={busy || products.length === 0}>{busy ? "Сохраняем…" : "Создать поставку"}</button></div>
      {products.length === 0 && <p className="form-help">Сначала добавьте товары в каталог.</p>}
      <p className="form-help">Расходы на кросс-докинг загружаются вместе с общими расходами Ozon.</p>
    </form>
  </section>;
}

function SupplyEditDialog({ supply, products, onClose, onSaved }: { supply: JsonRecord; products: ProductSelectOption[]; onClose: () => void; onSaved: () => void }) {
  const id = getId(supply);
  const initialLines = Array.isArray(supply.lines) ? supply.lines.flatMap((value) => {
    const line = asRecord(value);
    return line && typeof line.productId === "string" ? [{ productId: line.productId, quantity: String(line.quantity ?? ""), sku: typeof line.sku === "string" ? line.sku : "", title: typeof line.title === "string" ? line.title : "" }] : [];
  }) : [];
  const [lines, setLines] = useState<SupplyEditLine[]>(initialLines.length ? initialLines : [{ productId: "", quantity: "", sku: "", title: "" }]);
  const [suppliedAt, setSuppliedAt] = useState(typeof supply.suppliedAt === "string" ? supply.suppliedAt.slice(0, 10) : localToday());
  const [marketplace, setMarketplace] = useState(String(supply.marketplace ?? "unknown"));
  const [note, setNote] = useState(String(supply.note ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    setBusy(true); setError("");
    try {
      await requestJson(`/api/supplies?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          suppliedAt,
          marketplace,
          note,
          lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
        }),
      });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить поставку"); }
    finally { setBusy(false); }
  }

  return <div className="product-edit-backdrop">
    <section className="panel product-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="supply-edit-title">
      <div className="panel-head"><div><h2 id="supply-edit-title">Редактирование поставки</h2></div><button type="button" className="icon-button" aria-label="Закрыть редактирование" onClick={onClose}><X size={15} /></button></div>
      <form className="panel-body" onSubmit={submit}>
        {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}
        <div className="form-grid">
          <div className="field"><label htmlFor="edit-supply-date">Дата поставки *</label><input id="edit-supply-date" type="date" required value={suppliedAt} onChange={(event) => setSuppliedAt(event.target.value)} /></div>
          <div className="field"><label htmlFor="edit-supply-marketplace">Площадка *</label><select id="edit-supply-marketplace" value={marketplace} required onChange={(event) => setMarketplace(event.target.value)}>{supplyMarketplaceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          <div className="field wide"><label htmlFor="edit-supply-note">Комментарий</label><input id="edit-supply-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <div className="form-help" style={{ marginBottom: 8, color: "#5f6d64", fontWeight: 700 }}>Состав поставки</div>
        <div className="line-items">{lines.map((line, index) => {
          const availableProducts = products.filter((product) => product.id === line.productId || !lines.some((other, row) => row !== index && other.productId === product.id));
          const fallbackOption = line.productId && !products.some((product) => product.id === line.productId)
            ? productFallbackOption(line.productId, { sku: line.sku, title: line.title })
            : undefined;
          return <div className="line-item" key={index}>
          <div className="field"><label htmlFor={`edit-supply-product-${index}`}>Товар *</label><ProductSelect id={`edit-supply-product-${index}`} required value={line.productId} products={availableProducts} fallbackOption={fallbackOption} onChange={(productId) => setLines((current) => current.map((item, row) => {
            if (row !== index) return item;
            const product = products.find((candidate) => candidate.id === productId);
            return { ...item, productId, sku: product ? product.offerId || product.sku : item.sku, title: product?.title ?? item.title };
          }))} /></div>
          <div className="field"><label htmlFor={`edit-supply-quantity-${index}`}>Количество, шт. *</label><input id={`edit-supply-quantity-${index}`} type="number" min="1" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} /></div>
          <button type="button" className="icon-button" aria-label="Удалить товар из поставки" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><Trash2 size={14} /></button>
        </div>;
        })}</div>
        <div className="form-actions" style={{ justifyContent: "space-between" }}><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, { productId: "", quantity: "", sku: "", title: "" }])}><Plus size={14} />Добавить товар</button><div className="toolbar"><button type="button" className="button secondary" onClick={onClose}>Отмена</button><button className="button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button></div></div>
      </form>
    </section>
  </div>;
}

type SupplyCargoLabel = { id: string; cargoId: string; cargoType: string; ready: boolean; needsRetry: boolean; imageUrl: string | null };

function readCargoLabels(value: unknown): SupplyCargoLabel[] {
  const items = asRecord(value)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const label = asRecord(item);
    if (!label || typeof label.id !== "string" || typeof label.cargoId !== "string") return [];
    return [{
      id: label.id,
      cargoId: label.cargoId,
      cargoType: typeof label.cargoType === "string" ? label.cargoType : "",
      ready: label.ready === true,
      needsRetry: label.needsRetry === true,
      imageUrl: typeof label.imageUrl === "string" ? label.imageUrl : null,
    }];
  });
}

function cargoTypeLabel(value: string) {
  if (value.toUpperCase() === "BOX") return "Короб";
  if (value.toUpperCase() === "PALLET") return "Палета";
  return value || "Грузоместо";
}

function SupplyLabelsDialog({ supply, onClose }: { supply: JsonRecord; onClose: () => void }) {
  const [error, setError] = useState("");
  const [labels, setLabels] = useState<SupplyCargoLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const id = getId(supply);
  const ozonSupplyId = typeof supply.ozonSupplyId === "string" ? supply.ozonSupplyId : "";
  const title = typeof supply.note === "string" && supply.note.trim() ? supply.note : `Поставка ${ozonSupplyId ? `Ozon № ${ozonSupplyId}` : ""}`;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const value = await requestJson(`/api/supplies/labels?supplyId=${encodeURIComponent(id)}`);
        if (!cancelled) setLabels(readCargoLabels(value));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить этикетки.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const onSyncComplete = () => { void load(); };
    void load();
    window.addEventListener(OZON_SYNC_COMPLETED_EVENT, onSyncComplete);
    return () => {
      cancelled = true;
      window.removeEventListener(OZON_SYNC_COMPLETED_EVENT, onSyncComplete);
    };
  }, [id]);

  return <div className="product-edit-backdrop">
    <section className="panel product-edit-dialog supply-label-dialog" role="dialog" aria-modal="true" aria-labelledby="supply-label-title">
      <div className="panel-head"><div><h2 id="supply-label-title">{title}</h2><span className="small-note">{typeof supply.marketplaceLabel === "string" ? supply.marketplaceLabel : "Поставка"}</span></div><button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={15} /></button></div>
      <div className="panel-body">
        {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}
        {supply.marketplace === "ozon" && ozonSupplyId
          ? <>
              {loading ? <div className="loading-line" aria-label="Загружаем этикетки" /> : labels.length === 0
                ? <p className="supply-label-empty">Для этой поставки грузоместа пока не найдены.</p>
                : <div className="supply-label-list">{labels.map((label) => <article className="supply-label-card" key={label.id}>
                    <div className="supply-label-card-head"><div><strong>Грузоместо {label.cargoId}</strong><span>{cargoTypeLabel(label.cargoType)}</span></div>
                      {label.ready && label.imageUrl && <a className="button secondary small" href={`${label.imageUrl}?download=1`}><Download size={13} />Скачать PNG</a>}
                    </div>
                    {label.ready && label.imageUrl
                      ? <div className="supply-label-preview"><img className="supply-label-image" src={label.imageUrl} alt={`Этикетка грузоместа ${label.cargoId}`} /></div>
                      : <p className="supply-label-pending">{label.needsRetry ? "Ozon не подготовил этикетку. Повторим при следующей синхронизации." : "Этикетка появится после следующей синхронизации с Ozon."}</p>}
                  </article>)}</div>}
            </>
          : <p className="supply-label-empty">Этикетки доступны для поставок Ozon с привязанным номером поставки.</p>}
        <div className="form-actions supply-label-actions">
          <button type="button" className="button secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </section>
  </div>;
}

export function SuppliesWorkspace() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [products, setProducts] = useState<ProductSelectOption[]>([]);
  const [editingSupply, setEditingSupply] = useState<JsonRecord | null>(null);
  const [labelsSupply, setLabelsSupply] = useState<JsonRecord | null>(null);

  useEffect(() => { requestJson("/api/products").then((value) => setProducts(productOptions(value))).catch(() => setProducts([])); }, []);

  return <>
    <ResourcePage refreshKey={refreshKey} beforeTable={<SupplyEntryForm products={products} onSaved={() => setRefreshKey((value) => value + 1)} />} rowActions={(row) => <button type="button" className="button secondary small supply-row-edit" aria-label={`Изменить поставку ${String(row.note ?? "")}`} onClick={() => setEditingSupply(row)}><Pencil size={12} />Изменить</button>} config={{
    title: "Поставки на Ozon", eyebrow: "Перемещение товара",
    description: "Создавайте поставки вручную после оформления заявки в Ozon. Сервис не ждёт приёмки: складской остаток перемещается сразу.",
    collectionUrl: "/api/supplies", createUrl: "/api/supplies", hideCreate: true,
    fields: [], columns: [
      { key: "suppliedAt", label: "Дата", kind: "date" }, { key: "marketplaceLabel", label: "Площадка" }, { key: "articles", label: "Артикулы", primary: true },
      { key: "shippingCost", label: "Доставка", kind: "money" },
      { key: "quantity", label: "Единиц", kind: "quantity" }, { key: "note", label: "Комментарий" },
      { key: "cargoLabels", label: "Грузоместа", value: (row) => row.cargoLabelCount, render: (row) => {
        const total = typeof row.cargoLabelCount === "number" ? row.cargoLabelCount : 0;
        const ready = typeof row.readyCargoLabelCount === "number" ? row.readyCargoLabelCount : 0;
        const label = total ? `${ready} из ${total}` : "Открыть";
        return <button type="button" className="button secondary small" aria-label={`Открыть этикетки и детали поставки ${String(row.ozonSupplyId ?? row.note ?? "")}`} onClick={() => setLabelsSupply(row)}><Barcode size={13} />{label}</button>;
      } },
    ],
    deleteUrl: (row: JsonRecord) => typeof row.id === "string" ? `/api/supplies?id=${encodeURIComponent(row.id)}` : null,
    emptyTitle: "Поставок пока нет", emptyDescription: "Создайте поставку после оформления заявки в Ozon. Она сразу переместит товар между вашими складами.",
  }} />
    {editingSupply && <SupplyEditDialog key={getId(editingSupply)} supply={editingSupply} products={products} onClose={() => setEditingSupply(null)} onSaved={() => { setEditingSupply(null); setRefreshKey((value) => value + 1); }} />}
    {labelsSupply && getId(labelsSupply) && <SupplyLabelsDialog key={getId(labelsSupply)} supply={labelsSupply} onClose={() => setLabelsSupply(null)} />}
  </>;
}
