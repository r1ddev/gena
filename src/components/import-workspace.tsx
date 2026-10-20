"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, FileUp, Upload } from "lucide-react";
import { asRecord, requestJson } from "./api";
import { PageHeader } from "./page-header";

type ImportPreviewRow = {
  id?: string;
  sheetName: string;
  rowNumber: number;
  type: string;
  data?: { headers?: string[]; cells?: Record<string, unknown>; values?: unknown[] };
};

type ImportPreview = {
  batchId: string;
  summary: {
    sheets?: string[];
    totalRows?: number;
    byType?: Record<string, number>;
    unrecognizedRows?: number;
    note?: string;
  };
  rows: ImportPreviewRow[];
};

type ImportIssue = { sheet: string; row: number; message: string };
type ImportResult = {
  batchId: string;
  imported: Record<string, number>;
  skippedRows: number;
  issues: ImportIssue[];
};

const typeLabels: Record<string, string> = {
  products: "Товары", purchases: "Закупки", expenses: "Расходы", supplies: "Поставки",
  sales: "Продажи", returns: "Возвраты", writeoffs: "Списания", stocktakes: "Инвентаризации", unknown: "Не распознано",
};

function asImportPreview(value: unknown): ImportPreview | null {
  const root = asRecord(value);
  if (!root || typeof root.batchId !== "string" || !Array.isArray(root.rows)) return null;
  const summary = asRecord(root.summary) ?? {};
  return {
    batchId: root.batchId,
    summary: {
      sheets: Array.isArray(summary.sheets) ? summary.sheets.filter((sheet): sheet is string => typeof sheet === "string") : [],
      totalRows: typeof summary.totalRows === "number" ? summary.totalRows : root.rows.length,
      byType: asRecord(summary.byType) as Record<string, number> | undefined,
      unrecognizedRows: typeof summary.unrecognizedRows === "number" ? summary.unrecognizedRows : 0,
      note: typeof summary.note === "string" ? summary.note : undefined,
    },
    rows: root.rows.filter((row): row is ImportPreviewRow => {
      const record = asRecord(row);
      return Boolean(record && typeof record.sheetName === "string" && typeof record.rowNumber === "number" && typeof record.type === "string");
    }),
  };
}

function asImportResult(value: unknown): ImportResult | null {
  const root = asRecord(value);
  if (!root || typeof root.batchId !== "string") return null;
  const issues = Array.isArray(root.issues) ? root.issues.flatMap((item) => {
    const issue = asRecord(item);
    return issue && typeof issue.sheet === "string" && typeof issue.row === "number" && typeof issue.message === "string"
      ? [{ sheet: issue.sheet, row: issue.row, message: issue.message }]
      : [];
  }) : [];
  return {
    batchId: root.batchId,
    imported: asRecord(root.imported) as Record<string, number> ?? {},
    skippedRows: typeof root.skippedRows === "number" ? root.skippedRows : issues.length,
    issues,
  };
}

function formatRowData(row: ImportPreviewRow) {
  const cells = row.data?.cells;
  if (!cells) return row.data?.values?.map((value) => String(value ?? "")).filter(Boolean).join(" · ") || "—";
  const entries = Object.entries(cells).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  return entries.slice(0, 6).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ") || "—";
}

export function ImportWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function previewFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setError("Поддерживаются только файлы .xlsx и .csv.");
      return;
    }
    setBusy(true); setError(""); setSuccess(""); setPreview(null); setApplyResult(null);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await requestJson("/api/import", { method: "POST", body: form });
      const result = asImportPreview(response);
      if (!result) throw new Error("Сервис вернул ответ в неожиданном формате. Повторите проверку файла.");
      setPreview(result);
      setSuccess("Предварительный разбор готов. Проверьте сводку и строки, затем подтвердите перенос.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл"); }
    finally { setBusy(false); }
  }

  async function applyImport() {
    if (!preview?.batchId) return;
    setApplying(true); setError(""); setSuccess("");
    try {
      const response = await requestJson("/api/import/apply", { method: "POST", body: JSON.stringify({ batchId: preview.batchId }) });
      const result = asImportResult(response);
      if (!result) throw new Error("Перенос выполнен, но сервис вернул отчёт в неожиданном формате.");
      setApplyResult(result); setPreview(null); setFile(null); setSuccess("Перенос завершён. Ниже показаны добавленные записи и строки, которые потребовали разбора.");
      if (inputRef.current) inputRef.current.value = "";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось применить перенос"); }
    finally { setApplying(false); }
  }

  const extensionSupported = !file || /\.(xlsx|csv)$/i.test(file.name);
  return <>
    <PageHeader eyebrow="Начальный перенос данных" title="Перенос данных" description="Загрузите файл Excel (.xlsx) или CSV с историей операций и справочниками. Сначала сервис покажет предварительный разбор, чтобы вы проверили строки перед переносом." />
    {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}
    {success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}

    <section className="panel form-panel">
      <div className="panel-head"><div><h2>Предварительная проверка файла</h2><span className="small-note">Данные не будут перенесены до вашего подтверждения</span></div><FileSpreadsheet size={17} color="#178b63" /></div>
      <form className="panel-body" onSubmit={previewFile}>
        <div className="field full"><label htmlFor="import-file">Файл .xlsx или .csv</label><input ref={inputRef} id="import-file" type="file" accept=".xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setApplyResult(null); setError(""); setSuccess(""); }} /></div>
        {file && <div className="form-help">Выбран файл: {file.name} · {(file.size / 1024).toFixed(0)} КБ{!extensionSupported && " · формат не поддерживается"}</div>}
        <div className="form-actions"><button className="button" disabled={!file || !extensionSupported || busy}><Upload size={14} />{busy ? "Проверяем…" : "Проверить файл"}</button></div>
      </form>
    </section>

    {preview && <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><div><h2>Результат проверки</h2><span className="small-note">Пакет {preview.batchId}</span></div><button className="button" onClick={() => void applyImport()} disabled={applying}><CheckCircle2 size={14} />{applying ? "Переносим…" : "Подтвердить перенос"}</button></div>
      <div className="panel-body">
        <div className="mini-stat-list">
          <div className="mini-stat"><span className="mini-stat-label">Листы файла</span><span className="mini-stat-value">{preview.summary.sheets?.join(", ") || "—"}</span></div>
          <div className="mini-stat"><span className="mini-stat-label">Строк найдено</span><span className="mini-stat-value">{preview.summary.totalRows ?? preview.rows.length}</span></div>
          <div className="mini-stat"><span className="mini-stat-label">Не распознано</span><span className="mini-stat-value">{preview.summary.unrecognizedRows ?? 0}</span></div>
          {Object.entries(preview.summary.byType ?? {}).map(([type, count]) => <div className="mini-stat" key={type}><span className="mini-stat-label">{typeLabels[type] ?? type}</span><span className="mini-stat-value">{count}</span></div>)}
        </div>
        {preview.summary.note && <p className="form-help">{preview.summary.note}</p>}
        {preview.rows.length > 0 ? <div className="preview-box"><div className="table-wrap"><table><thead><tr><th>Лист</th><th>Строка</th><th>Тип данных</th><th>Содержимое строки</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={row.id ?? `${row.sheetName}:${row.rowNumber}:${index}`}><td>{row.sheetName}</td><td>{row.rowNumber}</td><td><span className={`badge ${row.type === "unknown" ? "orange" : "green"}`}>{typeLabels[row.type] ?? row.type}</span></td><td>{formatRowData(row)}</td></tr>)}</tbody></table></div>{(preview.summary.totalRows ?? 0) > preview.rows.length && <p className="form-help">Показаны первые {preview.rows.length} строк из {preview.summary.totalRows}.</p>}</div> : <p className="form-help">В файле не найдено строк для переноса. Подтверждение всё равно сохранит отчёт проверки.</p>}
      </div>
    </section>}

    {applyResult && <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><div><h2>Отчёт о переносе</h2><span className="small-note">Пакет {applyResult.batchId}</span></div><CheckCircle2 size={17} color="#178b63" /></div>
      <div className="panel-body">
        <div className="mini-stat-list">
          {Object.entries(applyResult.imported).map(([type, count]) => <div className="mini-stat" key={type}><span className="mini-stat-label">{typeLabels[type] ?? type} перенесено</span><span className="mini-stat-value">{count}</span></div>)}
          <div className="mini-stat"><span className="mini-stat-label">Пропущено строк</span><span className="mini-stat-value">{applyResult.skippedRows}</span></div>
        </div>
        {applyResult.issues.length > 0 && <div className="preview-box"><h3 style={{ fontSize: 12, marginBottom: 10 }}>Строки, требующие разбора</h3><div className="table-wrap"><table><thead><tr><th>Лист</th><th>Строка</th><th>Причина</th></tr></thead><tbody>{applyResult.issues.map((issue, index) => <tr key={`${issue.sheet}:${issue.row}:${index}`}><td>{issue.sheet}</td><td>{issue.row}</td><td>{issue.message}</td></tr>)}</tbody></table></div>{applyResult.skippedRows > applyResult.issues.length && <p className="form-help">Показаны первые {applyResult.issues.length} из {applyResult.skippedRows} строк с замечаниями.</p>}</div>}
        {applyResult.skippedRows === 0 && <div className="success-banner" style={{ marginTop: 13, marginBottom: 0 }}><CheckCircle2 size={14} />Все распознанные строки перенесены без пропусков.</div>}
      </div>
    </section>}

    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-body" style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><div className="empty-icon" style={{ margin: 0, flex: "0 0 auto" }}><FileUp size={19} /></div><div><div className="settings-title">Как проходит перенос</div><p className="settings-description" style={{ marginBottom: 0 }}>Сервис сначала показывает состав файла. После подтверждения распознанные операции добавляются в учёт, а пропущенные строки и причины сохраняются в отчёте. Повторное применение того же пакета заблокировано.</p></div></div>
    </section>
  </>;
}
