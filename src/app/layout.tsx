import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Учёт продавца Ozon",
  description: "Учёт товаров, остатков, продаж и расходов",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
