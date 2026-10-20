"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Archive, ArrowLeftRight, Banknote, Boxes, Calculator, ChartNoAxesCombined,
  ChevronRight, CircleDollarSign, ClipboardList, LayoutDashboard,
  Menu, Package, PackageCheck, RotateCcw, Settings2, ShoppingCart, Truck,
  Wallet, X,
} from "lucide-react";

const navSections = [
  {
    label: "Управление",
    links: [
      { href: "/", label: "Обзор", icon: LayoutDashboard },
      { href: "/catalog", label: "Каталог", icon: Boxes },
      { href: "/purchases", label: "Закупки", icon: ShoppingCart },
      { href: "/supplies", label: "Поставки на Ozon", icon: Truck },
      { href: "/expenses", label: "Расходы", icon: Wallet },
    ],
  },
  {
    label: "Операции",
    links: [
      { href: "/sales", label: "Продажи и заказы", icon: ChartNoAxesCombined },
      { href: "/returns", label: "Возвраты", icon: RotateCcw },
      { href: "/writeoffs", label: "Списания", icon: ArrowLeftRight },
      { href: "/stocktake", label: "Инвентаризация", icon: ClipboardList },
    ],
  },
  {
    label: "Аналитика",
    links: [{ href: "/scenario", label: "Номинальный расчёт", icon: Calculator }],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-frame">
      {mobileOpen && <button className="mobile-backdrop" aria-label="Закрыть меню" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label="Основная навигация">
        <Link className="brand" href="/" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark">G</span>
          <span><span className="brand-name">Gena</span><span className="brand-caption" style={{ display: "block" }}>учёт продавца</span></span>
        </Link>
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="nav-label">{section.label}</div>
            <nav className="nav-list">
              {section.links.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return <Link key={href} className={`nav-link ${active ? "active" : ""}`} href={href} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{active && <ChevronRight size={14} style={{ marginLeft: "auto", opacity: .72 }} />}</Link>;
              })}
            </nav>
          </div>
        ))}
        <div className="sidebar-spacer" />
        <Link className={`nav-link ${pathname.startsWith("/settings") ? "active" : ""}`} href="/settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined} onClick={() => setMobileOpen(false)}><Settings2 size={16} strokeWidth={1.8} /><span>Настройки</span></Link>
        <div className="sidebar-bottom">Личный кабинет · Ozon FBO</div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"} onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X size={17} /> : <Menu size={17} />}</button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
