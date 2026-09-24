import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ottodot Trial Booking",
  description: "Minimal trial booking slice: booking, mock payment, roster.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Ottodot · Trial Booking</Link>
          <nav>
            <Link href="/">Book a trial</Link>
            <Link href="/admin">Admin roster</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
