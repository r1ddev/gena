"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, KeyRound, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { asRecord, requestJson } from "./api";
import { PageHeader } from "./page-header";

export function SettingsWorkspace() {
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [savedApiKey, setSavedApiKey] = useState(false);
  const [interval, setInterval] = useState("24");
  const [lastSync, setLastSync] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = asRecord(await requestJson("/api/settings"));
      const value = asRecord(data?.data) ?? data;
      if (!value) return;
      setClientId(String(value.ozonClientId ?? value.clientId ?? ""));
      setInterval(String(value.syncIntervalHours ?? 24));
      setSavedApiKey(Boolean(value.hasApiKey ?? value.apiKeyConfigured));
      setLastSync(typeof value.lastSyncAt === "string" ? value.lastSyncAt : "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройки"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    const payload: Record<string, string | number> = { clientId: clientId.trim(), syncIntervalHours: Number(interval) };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    try {
      await requestJson("/api/settings", { method: "POST", body: JSON.stringify(payload) });
      setApiKey(""); setSavedApiKey(savedApiKey || Boolean(payload.apiKey)); setSuccess("Настройки сохранены в локальной базе данных."); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить настройки"); }
    finally { setSaving(false); }
  }

  async function syncNow() {
    setSyncing(true); setError(""); setSuccess("");
    try { await requestJson("/api/sync", { method: "POST", body: JSON.stringify({ kind: "full" }) }); setSuccess("Синхронизация поставлена в очередь. Статусы и возвраты появятся после завершения обработки."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось запустить синхронизацию"); }
    finally { setSyncing(false); }
  }

  return <>
    <PageHeader eyebrow="Подключения и обслуживание" title="Настройки" description="Подключите кабинет Ozon, проверьте синхронизацию и резервные копии локальных данных." actions={<button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} />Обновить</button>} />
    {error && <div className="error-banner" role="alert"><AlertCircle size={15} />{error}</div>}{success && <div className="success-banner" role="status"><CheckCircle2 size={15} />{success}</div>}
    <section className="panel">
      <form onSubmit={save}>
        <div className="settings-section">
          <div className="settings-title">Подключение к Ozon Seller API</div>
          <p className="settings-description">Укажите Client ID и API-ключ из кабинета продавца. Доступ нужен для загрузки заказов, статусов и возвратов. Секрет сохраняется в локальной базе и не показывается после сохранения.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="ozon-client-id">Client ID</label><input id="ozon-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" disabled={loading} /></div>
            <div className="field"><label htmlFor="ozon-api-key">API-ключ</label><input id="ozon-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={savedApiKey ? "Ключ сохранён; введите новый для замены" : "Вставьте API-ключ"} disabled={loading} /></div>
          </div>
          {savedApiKey && <p className="form-help"><ShieldCheck size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> API-ключ уже сохранён. Пустое поле не заменит текущий ключ.</p>}
          <div className="form-actions"><button className="button" disabled={saving || loading}><Save size={14} />{saving ? "Сохраняем…" : "Сохранить подключение"}</button></div>
        </div>
        <div className="settings-section">
          <div className="settings-title">Автоматическое обновление</div>
          <p className="settings-description">Рабочий процесс проверяет заказы и возвраты по расписанию. Также можно запустить синхронизацию вручную.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="sync-interval">Интервал, часов</label><select id="sync-interval" value={interval} onChange={(event) => setInterval(event.target.value)}><option value="24">Раз в день</option><option value="12">Каждые 12 часов</option><option value="6">Каждые 6 часов</option></select></div>
            <div className="field"><label htmlFor="last-sync">Последнее обновление</label><div id="last-sync" className="status-pill" style={{ width: "fit-content", minHeight: 38, borderRadius: 8 }}>{lastSync ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSync)) : "Ещё не запускалось"}</div></div>
          </div>
          <div className="form-actions" style={{ justifyContent: "space-between" }}><span className="form-help"><Clock3 size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> Синхронизация работает, пока запущен сервис на этом компьютере.</span><button type="button" className="button secondary" onClick={() => void syncNow()} disabled={syncing}><RefreshCw size={14} />{syncing ? "Запускаем…" : "Обновить сейчас"}</button></div>
        </div>
      </form>
      <div className="settings-section">
        <div className="settings-title">Резервные копии</div>
        <p className="settings-description" style={{ marginBottom: 0 }}>Локальная база и настройки копируются автоматически каждый день. Хранятся последние 30 копий, включая настройки подключения для восстановления сервиса.</p>
      </div>
    </section>
  </>;
}
