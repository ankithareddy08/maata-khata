import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maata Khata",
  description: "Speak your shop's credit book in Telugu, Hindi or English. A voice-first ledger for kirana stores.",
};

export const viewport: Viewport = {
  themeColor: "#f2f4f7",
};

// Read the saved language before first paint, so a Hindi or English user never sees a Telugu flash.
const restoreLanguage = `try{var l=localStorage.getItem("maata-khata-lang");if(l==="hi"||l==="en")document.documentElement.lang=l}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="te" suppressHydrationWarning>
    <body>
      <Script id="restore-language" strategy="beforeInteractive">{restoreLanguage}</Script>
      {children}
    </body>
  </html>;
}
