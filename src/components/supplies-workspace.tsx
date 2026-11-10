"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Pencil, Plus, Trash2, Truck, X } from "lucide-react";
import { asRecord, findRows, getId, localToday, requestJson, type JsonRecord } from "./api";
import { ResourcePage } from "./resource-page";

type ProductOption = { id: string; label: string };
type SupplyEditLine = { productId: string; quantity: string; sku: string };

function productOptions(value: unknown): ProductOption[] {
  return findRows(value).flatMap((row) => {
    const id = getId(row);
    if (!id) return [];
    const article = typeof row.sku === "string" && row.sku ? row.sku : typeof row.offerId === "string" && row.offerId ? row.offerId : "Артикул не указан";
    return [{ id, label: article }];
  });
}

function SupplyEntryForm({ products, onSaved }: { products: ProductOption[]; onSaved: () => void }) {
  const [lines, setLines] = useState([{ productId: "", quantity: "" }]);
  const [suppliedAt, setSuppliedAt] = useState(localToday());
  const [shippingCost, setShippingCost] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson("/api/supplies", { method: "POST", body: JSON.stringify({ suppliedAt, shippingCost: Number(shippingCost), note, lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })) }) });
      setLines([{ productId: "", quantity: "" }]); setShippingCost("0"); setNote(""); setSuccess("Поставка создана: товар перемещён на склад Ozon. Расход на доставку учтён."); onSaved();
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
        <div className="field"><label htmlFor="supply-shipping">Доставка, ₽</label><input id="supply-shipping" type="number" min="0" step="0.01" value={shippingCost} onChange={(event) => setShippingCost(event.target.value)} /></div>
        <div className="field wide"><label htmlFor="supply-note">Комментарий</label><input id="supply-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Номер заявки или заметка" /></div>
      </div>
      <div className="form-help" style={{ marginBottom: 8, color: "#5f6d64", fontWeight: 700 }}>Состав поставки</div>
      <div className="line-items">{lines.map((line, index) => <div className="line-item" key={index}>
        <div className="field"><label htmlFor={`supply-product-${index}`}>Артикул *</label><select id={`supply-product-${index}`} required value={line.productId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, productId: event.target.value } : item))}><option value="">Выберите артикул…</option>{products.map((product) => <option value={product.id} key={product.id}>{product.label}</option>)}</select></div>
        <div className="field"><label htmlFor={`supply-quantity-${index}`}>Количество, шт. *</label><input id={`supply-quantity-${index}`} type="number" min="1" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} /></div>
        <button type="button" className="icon-button" aria-label="Удалить товар из поставки" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><Trash2 size={14} /></button>
      </div>)}</div>
      <div className="form-actions" style={{ justifyContent: "space-between" }}><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, { productId: "", quantity: "" }])}><Plus size={14} />Добавить товар</button><button className="button" disabled={busy || products.length === 0}>{busy ? "Сохраняем…" : "Создать поставку"}</button></div>
      {products.length === 0 && <p className="form-help">Сначала добавьте товары в каталог.</p>}
      <p className="form-help">Расход на доставку уменьшает расчётный денежный баланс и один раз входит в общий коэффициент себестоимости. Удаление поставки отменит её влияние.</p>
    </form>
  </section>;
}

function SupplyEditDialog({ supply, products, onClose, onSaved }: { supply: JsonRecord; products: ProductOption[]; onClose: () => void; onSaved: () => void }) {
  const id = getId(supply);
  const initialLines = Array.isArray(supply.lines) ? supply.lines.flatMap((value) => {
    const line = asRecord(value);
    return line && typeof line.productId === "string" ? [{ productId: line.productId, quantity: String(line.quantity ?? ""), sku: typeof line.sku === "string" ? line.sku : "" }] : [];
  }) : [];
  const [lines, setLines] = useState<SupplyEditLine[]>(initialLines.length ? initialLines : [{ productId: "", quantity: "", sku: "" }]);
  const [suppliedAt, setSuppliedAt] = useState(typeof supply.suppliedAt === "string" ? supply.suppliedAt.slice(0, 10) : localToday());
  const [shippingCost, setShippingCost] = useState(String(supply.shippingCost ?? "0"));
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
          shippingCost: Number(shippingCost),
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
          <div className="field"><label htmlFor="edit-supply-shipping">Доставка, ₽</label><input id="edit-supply-shipping" type="number" min="0" step="0.01" value={shippingCost} onChange={(event) => setShippingCost(event.target.value)} /></div>
          <div className="field wide"><label htmlFor="edit-supply-note">Комментарий</label><input id="edit-supply-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <div className="form-help" style={{ marginBottom: 8, color: "#5f6d64", fontWeight: 700 }}>Состав поставки</div>
        <div className="line-items">{lines.map((line, index) => <div className="line-item" key={index}>
          <div className="field"><label htmlFor={`edit-supply-product-${index}`}>Артикул *</label><select id={`edit-supply-product-${index}`} required value={line.productId} onChange={(event) => setLines((current) => current.map((item, row) => {
            if (row !== index) return item;
            const productId = event.target.value;
            return { ...item, productId, sku: products.find((product) => product.id === productId)?.label ?? item.sku };
          }))}><option value="">Выберите артикул…</option>{line.productId && !products.some((product) => product.id === line.productId) && <option value={line.productId}>{line.sku || "Артикул сохранён"}</option>}{products.filter((product) => product.id === line.productId || !lines.some((other, row) => row !== index && other.productId === product.id)).map((product) => <option value={product.id} key={product.id}>{product.label}</option>)}</select></div>
          <div className="field"><label htmlFor={`edit-supply-quantity-${index}`}>Количество, шт. *</label><input id={`edit-supply-quantity-${index}`} type="number" min="1" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} /></div>
          <button type="button" className="icon-button" aria-label="Удалить товар из поставки" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><Trash2 size={14} /></button>
        </div>)}</div>
        <div className="form-actions" style={{ justifyContent: "space-between" }}><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, { productId: "", quantity: "", sku: "" }])}><Plus size={14} />Добавить товар</button><div className="toolbar"><button type="button" className="button secondary" onClick={onClose}>Отмена</button><button className="button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button></div></div>
      </form>
    </section>
  </div>;
}

export function SuppliesWorkspace() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [editingSupply, setEditingSupply] = useState<JsonRecord | null>(null);

  useEffect(() => { requestJson("/api/products").then((value) => setProducts(productOptions(value))).catch(() => setProducts([])); }, []);

  return <>
    <ResourcePage refreshKey={refreshKey} beforeTable={<SupplyEntryForm products={products} onSaved={() => setRefreshKey((value) => value + 1)} />} rowActions={(row) => <button type="button" className="button secondary small" onClick={() => setEditingSupply(row)}><Pencil size={12} />Изменить</button>} config={{
    title: "Поставки на Ozon", eyebrow: "Перемещение товара",
    description: "Создавайте поставки вручную после оформления заявки в Ozon. Сервис не ждёт приёмки: складской остаток перемещается сразу.",
    collectionUrl: "/api/supplies", createUrl: "/api/supplies", hideCreate: true,
    fields: [], columns: [
      { key: "suppliedAt", label: "Дата", kind: "date" }, { key: "articles", label: "Артикулы", primary: true },
      { key: "quantity", label: "Единиц", kind: "quantity" }, { key: "shippingCost", label: "Доставка", kind: "money" }, { key: "note", label: "Комментарий" },
    ],
    deleteUrl: (row: JsonRecord) => typeof row.id === "string" ? `/api/supplies?id=${encodeURIComponent(row.id)}` : null,
    emptyTitle: "Поставок пока нет", emptyDescription: "Создайте поставку после оформления заявки в Ozon. Она сразу переместит товар между вашими складами.",
  }} />
    {editingSupply && <SupplyEditDialog key={getId(editingSupply)} supply={editingSupply} products={products} onClose={() => setEditingSupply(null)} onSaved={() => { setEditingSupply(null); setRefreshKey((value) => value + 1); }} />}
  </>;
}
