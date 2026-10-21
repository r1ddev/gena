import { describe, expect, it } from "vitest";
import { assertLocalMutation, assertLocalRequest } from "./http";

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
    }))).toThrow("локального компьютера");
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
});
