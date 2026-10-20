import { describe, expect, it } from "vitest";
import { assertLocalRequest } from "./http";

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
