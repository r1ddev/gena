"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, PackageCheck } from "lucide-react";
import { findRows, getId, localToday, requestJson, type JsonRecord } from "./api";
import { ResourcePage } from "./resource-page";

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
    event.preventDefault(); if (!selectedId) return;
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
          <div className="field wide"><label htmlFor="purchase-id">Закупка *</label><select id="purchase-id" required value={selectedId} onChange={(event) => {
            const id = event.target.value;
            const purchase = receivablePurchases.find((item) => getId(item) === id);
            const expectedQuantity = Number(purchase?.expectedQuantity);
            setSelectedId(id);
            setQuantity(Number.isFinite(expectedQuantity) && expectedQuantity > 0 ? String(expectedQuantity) : "");
          }}><option value="">Выберите закупку…</option>{receivablePurchases.map((purchase) => { const id = getId(purchase); if (!id) return null; const title = typeof purchase.title === "string" ? purchase.title : String(purchase.productName ?? purchase.sku ?? "Закупка"); const date = typeof purchase.purchasedAt === "string" ? ` · ${purchase.purchasedAt.slice(0, 10)}` : ""; return <option key={id} value={id}>{title}{date} · ожидается {String(purchase.expectedQuantity)} шт.</option>; })}</select></div>
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
