import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/shared/toast";
import { ThemeInitializer } from "@/components/shared/theme-initializer";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const spaceMono = Space_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-space-mono",
});

const doto = localFont({
  src: "./fonts/doto-variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-doto",
  preload: false,
});

export const metadata: Metadata = {
  title: "FreeFrame",
  description: "Collaborative media review and approval platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${spaceMono.variable} ${doto.variable}`}
    >
      <head>
        {/* Inline script to apply theme BEFORE paint — prevents flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=JSON.parse(localStorage.getItem('ff-theme')||'{}');var t=d.state&&d.state.theme||'dark';if(t==='system'){t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <ThemeInitializer />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
