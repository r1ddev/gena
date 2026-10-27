"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Pencil, Save, TrendingUp, X } from "lucide-react";
import { asRecord, findRows, requestJson, type JsonRecord } from "./api";
import { PageHeader } from "./page-header";
import {
  calculateScenario,
  initialScenarioInputs,
  parseScenarioValue,
  scenarioFields,
  type ScenarioFieldId,
  type ScenarioInputs,
  type ScenarioParameters,
} from "@/domain/scenario";

const rubles = (value: number) => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
}).format(value);

const percentage = (value: number) => new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
}).format(value) + "%";

function parametersFromInputs(inputs: ScenarioInputs): ScenarioParameters | null {
  const pairs = scenarioFields.map(({ id }) => [id, parseScenarioValue(inputs[id])] as const);
  if (pairs.some(([, value]) => value === null)) return null;
  return Object.fromEntries(pairs) as ScenarioParameters;
}

function savedValue(parameters: JsonRecord | null, id: ScenarioFieldId, format: "money" | "percentage") {
  const value = Number(parameters?.[id]);
  if (!Number.isFinite(value)) return "—";
  return format === "money" ? rubles(value) : percentage(value);
}

function savedDate(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function ScenarioCalculator() {
  const [inputs, setInputs] = useState<ScenarioInputs>(initialScenarioInputs);
  const [comment, setComment] = useState("");
  const [savedCalculations, setSavedCalculations] = useState<JsonRecord[]>([]);
  const [editingId, setEditingId] = useState("");
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const parameters = useMemo(() => parametersFromInputs(inputs), [inputs]);
  const result = useMemo(() => parameters ? calculateScenario(parameters) : null, [parameters]);
  const resultHint = useMemo(() => {
    if (!parameters) return "Проверь формат чисел в полях.";
    if (parameters.sale <= 0) return "Продажа должна быть больше нуля.";
    if (parameters.successRate <= 0 || parameters.successRate > 100) return "Процент успешных доставок должен быть больше 0% и не выше 100%.";
    return "";
  }, [parameters]);

  const refreshSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      setSavedCalculations(findRows(await requestJson("/api/scenario-calculations")));
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Не удалось загрузить сохранённые расчёты.");
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => { void refreshSaved(); }, [refreshSaved]);

  async function saveCalculation() {
    if (!parameters || !result || !comment.trim()) return;
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const url = editingId ? `/api/scenario-calculations?id=${encodeURIComponent(editingId)}` : "/api/scenario-calculations";
      const response = asRecord(await requestJson(url, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ comment: comment.trim(), inputs: parameters }),
      }));
      const item = asRecord(response?.item);
      if (!item) throw new Error("Не удалось сохранить расчёт.");
      setSavedCalculations((current) => {
        const next = editingId
          ? current.map((row) => String(row.id) === editingId ? item : row)
          : [item, ...current];
        return next.sort((first, second) => String(second.createdAt ?? "").localeCompare(String(first.createdAt ?? "")));
      });
      setEditingId("");
      setComment("");
      setSaveMessage("Расчёт сохранён.");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Не удалось сохранить расчёт.");
    } finally {
      setSaving(false);
    }
  }

  function editCalculation(row: JsonRecord) {
    const values = asRecord(row.inputs);
    if (!values) return;
    const nextInputs = Object.fromEntries(scenarioFields.map(({ id }) => [id, String(values[id] ?? 0)])) as ScenarioInputs;
    setInputs(nextInputs);
    setComment(typeof row.comment === "string" ? row.comment : "");
    setEditingId(String(row.id ?? ""));
    setSaveError("");
    setSaveMessage("");
    document.getElementById("scenario-purchase")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function cancelEdit() {
    setEditingId("");
    setComment("");
    setSaveError("");
    setSaveMessage("");
  }

  return <>
    <PageHeader eyebrow="Отдельный расчёт" title="Номинальная прибыль" />
    <div className="scenario-layout">
      <section className="panel">
        <div className="panel-head">
          <div><h2>Параметры расчёта</h2></div>
          <Calculator size={17} color="#178b63" />
        </div>
        <div className="panel-body">
          <div className="form-grid">
            {scenarioFields.map(({ id, label }) => (
              <div className="field" key={id}>
                <label htmlFor={`scenario-${id}`}>{label}</label>
                <input
                  id={`scenario-${id}`}
                  className="scenario-number-input"
                  type="number"
                  step="0.01"
                  value={inputs[id]}
                  onChange={(event) => setInputs((current) => ({ ...current, [id]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="scenario-save-row">
            <div className="field">
              <label htmlFor="scenario-comment">Комментарий</label>
              <input
                id="scenario-comment"
                value={comment}
                maxLength={2000}
                placeholder="Например: цена для новой партии"
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
            <div className="scenario-save-actions">
              <button className="button" type="button" disabled={saving || !result || !comment.trim()} onClick={() => void saveCalculation()}>
                <Save size={14} />{saving ? "Сохраняю…" : editingId ? "Сохранить изменения" : "Сохранить расчёт"}
              </button>
              {editingId && <button className="button secondary" type="button" disabled={saving} onClick={cancelEdit}><X size={14} />Отмена</button>}
            </div>
          </div>
          {resultHint && <p className="form-help">{resultHint}</p>}
          {saveError && <p className="scenario-message error" role="alert">{saveError}</p>}
          {saveMessage && <p className="scenario-message success" role="status">{saveMessage}</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Итог к цене товара</h2>
          <TrendingUp size={17} color="#178b63" />
        </div>
        <div className="panel-body">
          <div className="scenario-result-grid">
            <div className="scenario-result">
              <span className="metric-label">Итог</span>
              <strong className="scenario-result-value" style={{ color: result && result.profit < 0 ? "var(--red)" : "var(--green-dark)" }}>
                {result ? rubles(result.profit) : "—"}
              </strong>
            </div>
            <div className="scenario-result">
              <span className="metric-label">Процент прибыли от дохода</span>
              <strong className="scenario-result-value" style={{ color: result && result.profitShare < 0 ? "var(--red)" : "var(--green-dark)" }}>
                {result ? percentage(result.profitShare) : "—"}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Сохранённые расчёты</h2>
          <span className="scenario-record-count">{savedCalculations.length}</span>
        </div>
        <div className="scenario-record-list">
          {loadingSaved && <div className="scenario-list-note">Загружаю расчёты…</div>}
          {!loadingSaved && savedCalculations.length === 0 && <div className="scenario-list-note">Сохранённых расчётов пока нет.</div>}
          {savedCalculations.map((row) => {
            const rowParameters = asRecord(row.inputs);
            const rowId = String(row.id ?? "");
            const profit = Number(row.profit);
            const profitShare = Number(row.profitShare);
            return <article className="scenario-record" key={rowId}>
              <header className="scenario-record-heading">
                <div>
                  <h3>{typeof row.comment === "string" && row.comment ? row.comment : "Без комментария"}</h3>
                  <span>{savedDate(row.createdAt)}</span>
                </div>
                <button className="icon-button" type="button" aria-label={`Редактировать расчёт: ${String(row.comment ?? "")}`} title="Редактировать расчёт" onClick={() => editCalculation(row)}>
                  <Pencil size={14} />
                </button>
              </header>
              <dl className="scenario-record-parameters">
                {scenarioFields.map(({ id, label, format }) => <div key={id}>
                  <dt>{label}</dt>
                  <dd>{savedValue(rowParameters, id, format)}</dd>
                </div>)}
              </dl>
              <div className="scenario-record-results">
                <div><span>Итог</span><strong style={{ color: profit < 0 ? "var(--red)" : "var(--green-dark)" }}>{Number.isFinite(profit) ? rubles(profit) : "—"}</strong></div>
                <div><span>Процент прибыли</span><strong style={{ color: profitShare < 0 ? "var(--red)" : "var(--green-dark)" }}>{Number.isFinite(profitShare) ? percentage(profitShare) : "—"}</strong></div>
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>
  </>;
}
