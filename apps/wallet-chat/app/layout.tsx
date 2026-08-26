import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ackrate — Mandate-controlled agent payments",
  description: "Sign a scoped Stellar mandate with LOBSTR and let an AI agent pay only through contract-enforced authorization.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
