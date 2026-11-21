import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "మాట ఖాతా · Maata Khata",
  description: "Speak your shop's credit book. A voice-first ledger for kirana stores.",
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f5ef" }, { media: "(prefers-color-scheme: dark)", color: "#0f1512" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="te"><body>{children}</body></html>;
}
