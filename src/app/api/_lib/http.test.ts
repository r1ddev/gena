import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalMutation } from "./http";

afterEach(() => vi.unstubAllEnvs());

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
