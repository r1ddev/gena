import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { ...props, href }, children),
}));

import { AppShell } from "./app-shell";

describe("AppShell navigation", () => {
  it("does not offer spreadsheet history import", () => {
    const html = renderToStaticMarkup(React.createElement(AppShell, null, React.createElement("div", null, "Dashboard")));

    expect(html).not.toContain('href="/import"');
    expect(html).not.toContain("Перенос данных");
  });
});
