import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dripp — Split the stock. Trade the drip.",
  description: "Pecah saham ter-tokenisasi Robinhood Chain menjadi PT (pokok) dan YT (dividen).",
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body className="min-h-dvh antialiased">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
