"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Link2, PackagePlus } from "lucide-react";
import { asRecord, findRows, getId, requestJson, stringValue, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import { notifyProductCatalogChanged, PRODUCT_CATALOG_CHANGED_EVENT } from "./product-hover-card";

type ProductOption = { id: string; label: string };
type ReferenceCount = { label: string; count: number };

function references(row: JsonRecord): ReferenceCount[] {
  return Array.isArray(row.blockers) ? row.blockers.flatMap((value) => {
    const item = asRecord(value);
    return typeof item?.label === "string" && Number(item.count) > 0
      ? [{ label: item.label, count: Number(item.count) }]
      : [];
  }) : [];
}

export function ProductReassignmentQueue({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [queue, catalog] = await Promise.all([
        requestJson("/api/product-reassignments"),
        requestJson("/api/products"),
      ]);
      setRows(findRows(queue));
      setProducts(findRows(catalog).flatMap((product) => {
        const id = getId(product);
        if (!id) return [];
        const identifiers = [
          typeof product.offerId === "string" && product.offerId ? `Артикул ${product.offerId}` : "",
          typeof product.ozonSku === "string" && product.ozonSku ? `SKU Ozon ${product.ozonSku}` : "",
        ].filter(Boolean);
        return [{ id, label: `${String(product.title ?? "Товар")}${identifiers.length ? ` · ${identifiers.join(" · ")}` : ""}` }];
      }));
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить список перераспределения");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    window.addEventListener(PRODUCT_CATALOG_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PRODUCT_CATALOG_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (embedded && rows.length === 0 && !error) return null;

  async function resolve(row: JsonRecord, action: "map" | "create") {
    const id = getId(row);
    if (!id) return;
    setBusy(id); setError(""); setSuccess("");
    try {
      const body = action === "map" ? { action, productId: selected[id] } : { action };
      await requestJson(`/api/product-reassignments?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      notifyProductCatalogChanged();
      setSelected((current) => { const { [id]: _removed, ...rest } = current; return rest; });
      setSuccess(action === "map" ? "Операции перенесены на выбранный товар." : "Товар создан заново, операции перенесены.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось перераспределить операции"); }
    finally { setBusy(""); }
  }

  return <>
    {!embedded && <PageHeader eyebrow="Товары" title="Распределить операции" description="Здесь сохранены операции товаров, принудительно удалённых из каталога." actions={<button type="button" className="button secondary" onClick={() => void refresh()}>Обновить</button>} />}
    {error && <div className="error-banner" role="alert"><AlertCircle size={16} />{error}</div>}
    {success && <div className="success-banner" role="status"><CheckCircle2 size={16} />{success}</div>}
    <section className="panel">
      <div className="panel-head"><h2>{embedded ? "Операции удалённых товаров" : "Товары для перераспределения"}</h2><div className="toolbar"><span className="badge orange">{rows.length}</span>{embedded && <button type="button" className="button secondary small" onClick={() => void refresh()}>Обновить</button>}</div></div>
      {loading && rows.length === 0 ? <div className="panel-body"><div className="loading-line" /></div>
        : rows.length === 0 ? <div className="empty-state"><div><div className="empty-icon"><CheckCircle2 size={20} /></div><div className="empty-title">Нет связанных операций</div>{!embedded && <p className="empty-description">Принудительно удалённые товары появятся здесь вместе со связанными операциями.</p>}</div></div>
          : <div className="reassignment-list">{rows.map((row) => {
            const id = getId(row);
            if (!id) return null;
            const counts = references(row);
            const article = stringValue(row.offerId) || stringValue(row.sku) || "Артикул не указан";
            const ozonSku = stringValue(row.ozonSku) || "—";
            return <article className="reassignment-item" key={id}>
              <div className="reassignment-product">
                {typeof row.imageUrl === "string" && row.imageUrl ? <img src={row.imageUrl} alt="" /> : <div className="reassignment-image-placeholder">Товар</div>}
                <div><h3>{String(row.title ?? "Товар")}</h3><div className="table-secondary">Артикул: {article} · SKU Ozon: {ozonSku}</div></div>
              </div>
              <div className="reassignment-references" aria-label="Связанные операции">
                {counts.map((item) => <span className="badge" key={item.label}>{item.label}: {item.count}</span>)}
              </div>
              <div className="reassignment-actions">
                <select aria-label={`Товар каталога для ${article}`} value={selected[id] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [id]: event.target.value }))}>
                  <option value="">Выберите товар каталога…</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}
                </select>
                <button type="button" className="button secondary" disabled={!selected[id] || busy === id} onClick={() => void resolve(row, "map")}><Link2 size={14} />Перенести</button>
                <button type="button" className="button" disabled={busy === id} onClick={() => void resolve(row, "create")}><PackagePlus size={14} />Создать заново</button>
              </div>
            </article>;
          })}</div>}
    </section>
  </>;
}
