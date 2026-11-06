"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import styles from "./auth-gate.module.css";

type AuthUser = { id: string; login: string };
type AuthContextValue = { user: AuthUser; logout: () => Promise<void> };
type AuthMode = "login" | "register";

const AuthContext = createContext<AuthContextValue | null>(null);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function responseMessage(value: unknown, fallback: string) {
  const object = record(value);
  const nested = record(object?.data) ?? object;
  const message = nested?.message ?? nested?.error;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function parseUser(value: unknown): AuthUser | null {
  const object = record(value);
  const nested = record(object?.data) ?? object;
  const user = record(nested?.user);
  return typeof user?.id === "string" && typeof user.login === "string"
    ? { id: user.id, login: user.login }
    : null;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthGate.");
  return auth;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [logoutError, setLogoutError] = useState("");

  const checkSession = useCallback(async () => {
    setChecking(true);
    setSessionError("");
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      const data: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const authenticatedUser = parseUser(data);
        if (!authenticatedUser) throw new Error("Не удалось проверить вход. Обновите страницу.");
        setUser(authenticatedUser);
        setRegistered(true);
      } else if (response.status === 401) {
        const object = record(data);
        const nested = record(object?.data) ?? object;
        setUser(null);
        setRegistered(typeof nested?.registered === "boolean" ? nested.registered : true);
      } else {
        throw new Error(responseMessage(data, "Не удалось проверить вход."));
      }
    } catch (reason) {
      setSessionError(reason instanceof Error ? reason.message : "Не удалось проверить вход.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void checkSession(); }, [checkSession]);

  const logout = useCallback(async () => {
    setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Не удалось выйти из аккаунта."));
      setUser(null);
      setRegistered(true);
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : "Не удалось выйти из аккаунта.");
    }
  }, []);

  const contextValue = useMemo(() => user ? { user, logout } : null, [logout, user]);

  if (checking) {
    return <main className={styles.screen} aria-busy="true"><section className={styles.card} role="status"><span className={styles.spinner} aria-hidden="true" /><span>Проверяем вход…</span></section></main>;
  }

  if (user && contextValue) {
    return <AuthContext.Provider value={contextValue}>
      {logoutError && <div className={styles.logoutError} role="alert">{logoutError}</div>}
      {children}
    </AuthContext.Provider>;
  }

  return <AuthForm
    registered={registered ?? true}
    initialError={sessionError}
    onAuthenticated={(authenticatedUser) => { setSessionError(""); setUser(authenticatedUser); setRegistered(true); }}
    onRetry={() => { void checkSession(); }}
  />;
}

function AuthForm({
  registered,
  initialError,
  onAuthenticated,
  onRetry,
}: {
  registered: boolean;
  initialError: string;
  onAuthenticated: (user: AuthUser) => void;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(registered ? "login" : "register");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode(registered ? "login" : "register");
  }, [registered]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, mode === "login" ? "Не удалось войти." : "Не удалось создать аккаунт."));
      const authenticatedUser = parseUser(data);
      if (!authenticatedUser) throw new Error("Аккаунт создан, но вход не подтвердился. Обновите страницу.");
      onAuthenticated(authenticatedUser);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить запрос.");
    } finally {
      setBusy(false);
    }
  }

  const isFirstAccount = !registered;

  return <main className={styles.screen}>
    <section className={styles.card} aria-labelledby="auth-title">
      <div className={styles.brandMark} aria-hidden="true">G</div>
      <p className={styles.eyebrow}>Учёт продавца Ozon</p>
      <h1 id="auth-title">{isFirstAccount ? "Создайте аккаунт владельца" : mode === "login" ? "Войти" : "Создать аккаунт"}</h1>
      <p className={styles.description}>
        {isFirstAccount
          ? "Первый аккаунт получит уже сохранённые товары, операции и настройки Ozon."
          : mode === "login"
            ? "Войдите, чтобы открыть свои товары, операции и настройки Ozon."
            : "Новый аккаунт получит отдельные товары, операции и настройки Ozon."}
      </p>

      {registered && <div className={styles.tabs} role="tablist" aria-label="Вход или регистрация">
        <button className={mode === "login" ? styles.activeTab : ""} type="button" role="tab" aria-selected={mode === "login"} onClick={() => { setMode("login"); setError(""); }}>Войти</button>
        <button className={mode === "register" ? styles.activeTab : ""} type="button" role="tab" aria-selected={mode === "register"} onClick={() => { setMode("register"); setError(""); }}>Регистрация</button>
      </div>}

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field} htmlFor="account-login">
          <span>Логин</span>
          <input id="account-login" name="username" type="text" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} minLength={3} maxLength={64} required disabled={busy} autoCapitalize="none" spellCheck={false} />
        </label>
        <label className={styles.field} htmlFor="account-password">
          <span>Пароль</span>
          <input id="account-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={128} required disabled={busy} />
          {mode === "register" && <small>Не короче 10 символов.</small>}
        </label>
        {(error || initialError) && <div className={styles.error} role="alert">{error || initialError}</div>}
        <button className={styles.submit} type="submit" disabled={busy || !login.trim() || password.length < 10}>
          {busy ? "Подождите…" : isFirstAccount ? "Создать аккаунт владельца" : mode === "login" ? "Войти" : "Зарегистрироваться"}
        </button>
      </form>
      {initialError && <button className={styles.retry} type="button" onClick={onRetry} disabled={busy}>Проверить ещё раз</button>}
    </section>
  </main>;
}
