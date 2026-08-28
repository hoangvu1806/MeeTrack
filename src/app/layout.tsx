import type { Metadata } from "next";
import Script from "next/script";
import "@fontsource-variable/inter/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeeTrack",
  description: "Local-first meeting intelligence",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

const initializeAppearance = `(function(){try{var t=localStorage.getItem('meetrack-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light';var l=localStorage.getItem('meetrack-locale');if(l)document.documentElement.lang=l}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        {children}
        <Script id="initialize-appearance" strategy="beforeInteractive">
          {initializeAppearance}
        </Script>
      </body>
    </html>
  );
}
