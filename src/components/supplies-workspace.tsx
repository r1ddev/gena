"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Plus, Trash2, Truck } from "lucide-react";
import { findRows, getId, localToday, requestJson, type JsonRecord } from "./api";
import { ResourcePage } from "./resource-page";

type ProductOption = { id: string; label: string };

function SupplyEntryForm({ onSaved }: { onSaved: () => void }) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [lines, setLines] = useState([{ productId: "", quantity: "" }]);
  const [suppliedAt, setSuppliedAt] = useState(localToday());
  const [shippingCost, setShippingCost] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { requestJson("/api/products").then((value) => setProducts(findRows(value).map((row) => {
    const id = getId(row); if (!id) return null;
    const article = typeof row.offerId === "string" && row.offerId ? row.offerId : typeof row.sku === "string" ? row.sku : "Артикул не указан";
    return { id, label: article };
  }).filter((row): row is ProductOption => row !== null))).catch(() => setProducts([])); }, []);

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
        <div className="field"><label htmlFor={`supply-product-${index}`}>Товар *</label><select id={`supply-product-${index}`} required value={line.productId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, productId: event.target.value } : item))}><option value="">Выберите товар…</option>{products.map((product) => <option value={product.id} key={product.id}>{product.label}</option>)}</select></div>
        <div className="field"><label htmlFor={`supply-quantity-${index}`}>Количество, шт. *</label><input id={`supply-quantity-${index}`} type="number" min="1" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} /></div>
        <button type="button" className="icon-button" aria-label="Удалить товар из поставки" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><Trash2 size={14} /></button>
      </div>)}</div>
      <div className="form-actions" style={{ justifyContent: "space-between" }}><button type="button" className="button secondary" onClick={() => setLines((current) => [...current, { productId: "", quantity: "" }])}><Plus size={14} />Добавить товар</button><button className="button" disabled={busy || products.length === 0}>{busy ? "Сохраняем…" : "Создать поставку"}</button></div>
      {products.length === 0 && <p className="form-help">Сначала добавьте товары в каталог.</p>}
      <p className="form-help">Расход на доставку уменьшает расчётный денежный баланс и один раз входит в общий коэффициент себестоимости. Удаление поставки отменит её влияние.</p>
    </form>
  </section>;
}

export function SuppliesWorkspace() {
  const [refreshKey, setRefreshKey] = useState(0);
  return <ResourcePage refreshKey={refreshKey} beforeTable={<SupplyEntryForm onSaved={() => setRefreshKey((value) => value + 1)} />} config={{
    title: "Поставки на Ozon", eyebrow: "Перемещение товара",
    description: "Создавайте поставки вручную после оформления заявки в Ozon. Сервис не ждёт приёмки: складской остаток перемещается сразу.",
    collectionUrl: "/api/supplies", createUrl: "/api/supplies", hideCreate: true,
    fields: [], columns: [
      { key: "suppliedAt", label: "Дата", kind: "date" }, { key: "products", label: "Состав", primary: true },
      { key: "quantity", label: "Единиц", kind: "quantity" }, { key: "shippingCost", label: "Доставка", kind: "money" }, { key: "note", label: "Комментарий" },
    ],
    deleteUrl: (row: JsonRecord) => typeof row.id === "string" ? `/api/supplies?id=${encodeURIComponent(row.id)}` : null,
    emptyTitle: "Поставок пока нет", emptyDescription: "Создайте поставку после оформления заявки в Ozon. Она сразу переместит товар между вашими складами.",
  }} />;
}
