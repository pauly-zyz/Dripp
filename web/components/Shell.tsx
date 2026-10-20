"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Drop, IconEarn, IconMarkets, IconPortfolio, IconShield } from "./Icons";
import { DEMO } from "@/lib/api";
import { ReferralBanner } from "./ReferralBanner";

const NAV = [
  { href: "/", label: "Markets", icon: IconMarkets },
  { href: "/earn", label: "Fixed Income", short: "Earn", icon: IconEarn },
  { href: "/portfolio", label: "Portofolio", icon: IconPortfolio },
  { href: "/transparency", label: "Transparansi", icon: IconShield },
];

const active = (path: string, href: string) => (href === "/" ? path === "/" || path.startsWith("/market/") : path.startsWith(href));

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Drop className="text-up" />
            dripp
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  active(path, n.href) ? "bg-card-2 text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <ConnectButton chainStatus="icon" accountStatus="avatar" showBalance={false} />
          </div>
        </div>
      </header>
      {DEMO && (
        <div className="border-b border-line/60 bg-card px-4 py-2 text-center text-xs text-muted">
          <span className="font-semibold text-fg">Mode demo</span> · data contoh, kontrak Dripp belum di-deploy. Transaksi tidak dikirim.
        </div>
      )}
      <ReferralBanner />
      <main className="mx-auto max-w-5xl px-4 pt-4 pb-28 md:pb-12">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map((n) => {
            const on = active(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${on ? "text-up" : "text-muted"}`}
              >
                <n.icon />
                {n.short ?? n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
