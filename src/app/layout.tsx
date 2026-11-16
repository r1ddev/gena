import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { TableColumnResizing } from "@/components/table-column-resizing";
import "./globals.css";

export const metadata: Metadata = {
  title: "Учёт продавца Ozon",
  description: "Учёт товаров, остатков, продаж и расходов",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body><TableColumnResizing /><AuthGate><AppShell>{children}</AppShell></AuthGate></body>
    </html>
  );
}
