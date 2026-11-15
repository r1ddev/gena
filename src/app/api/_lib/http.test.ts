import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalMutation, assertLocalRequest } from "./http";

afterEach(() => vi.unstubAllEnvs());

describe("assertLocalRequest", () => {
  it("accepts requests addressed to the local application", () => {
    expect(() => assertLocalRequest(new Request("http://localhost:3100/api/dashboard", {
      headers: { host: "localhost:3100" },
    }))).not.toThrow();
    expect(() => assertLocalRequest(new Request("http://[::1]:3100/api/dashboard", {
      headers: { host: "[::1]:3100" },
    }))).not.toThrow();
  });

  it("rejects non-local hosts that can reach loopback through DNS rebinding", () => {
    expect(() => assertLocalRequest(new Request("http://attacker.example/api/dashboard", {
      headers: { host: "attacker.example" },
    }))).toThrow("локальной сети");
  });

  it("accepts the configured public HTTPS host", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://gena-na.globalnetworkcorporation.ru");
    expect(() => assertLocalRequest(new Request("http://gena-na.globalnetworkcorporation.ru/api/auth/session", {
      headers: { host: "gena-na.globalnetworkcorporation.ru" },
    }))).not.toThrow();
  });

  it("rejects other external hosts when a public origin is configured", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://gena-na.globalnetworkcorporation.ru");
    expect(() => assertLocalRequest(new Request("http://attacker.example/api/auth/session", {
      headers: { host: "attacker.example" },
    }))).toThrow("локальной сети");
  });
});

describe("assertLocalMutation", () => {
  it("accepts an Origin that exactly matches the local application origin", () => {
    expect(() => assertLocalMutation(new Request("http://localhost:3100/api/sync", {
      method: "POST",
      headers: { host: "localhost:3100", origin: "http://localhost:3100" },
    }))).not.toThrow();
  });

  it("rejects a cross-origin request from another localhost port", () => {
    expect(() => assertLocalMutation(new Request("http://localhost:3100/api/sync", {
      method: "POST",
      headers: { host: "localhost:3100", origin: "http://localhost:5173" },
    }))).toThrow("Источник запроса");
  });

  it("rejects a scheme mismatch for a localhost Origin", () => {
    expect(() => assertLocalMutation(new Request("http://localhost:3100/api/sync", {
      method: "POST",
      headers: { host: "localhost:3100", origin: "https://localhost:3100" },
    }))).toThrow("Источник запроса");
  });

  it("accepts only the exact configured public HTTPS origin", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://gena-na.globalnetworkcorporation.ru");
    expect(() => assertLocalMutation(new Request("http://gena-na.globalnetworkcorporation.ru/api/auth/login", {
      method: "POST",
      headers: {
        host: "gena-na.globalnetworkcorporation.ru",
        origin: "https://gena-na.globalnetworkcorporation.ru",
      },
    }))).not.toThrow();
    expect(() => assertLocalMutation(new Request("http://gena-na.globalnetworkcorporation.ru/api/auth/login", {
      method: "POST",
      headers: {
        host: "gena-na.globalnetworkcorporation.ru",
        origin: "http://gena-na.globalnetworkcorporation.ru",
      },
    }))).toThrow("Источник запроса");
  });
});
