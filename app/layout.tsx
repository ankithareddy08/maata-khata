import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maata Khata",
  description: "Speak your shop's credit book in Telugu, Hindi or English. A voice-first ledger for kirana stores.",
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f5ef" }, { media: "(prefers-color-scheme: dark)", color: "#0f1512" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the saved language before first paint, so a Hindi or English user never sees a Telugu flash.
  const restoreLanguage = `try{var l=localStorage.getItem("maata-khata-lang");if(l==="hi"||l==="en")document.documentElement.lang=l}catch(e){}`;
  return <html lang="te" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: restoreLanguage }} /></head>
    <body>{children}</body>
  </html>;
}
