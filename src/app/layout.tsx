import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/sw-register";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PronoBot — Paris Sportifs IA",
  description: "Pronostics football intelligents alimentés par IA : analyse multi-source, Expected Goals, value bets et paris combinés.",
  keywords: ["paris", "sportifs", "pronostics", "football", "IA", "pronobot"],
  authors: [{ name: "PronoBot" }],
  applicationName: "PronoBot",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "PronoBot",
    statusBarStyle: "black-translucent",
    startupImage: ["/apple-touch-icon.png"],
  },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  // Note: userScalable is left enabled (and maximumScale unset) per WCAG 1.4.4
  // (users must be able to zoom to 200%). Pinning maximumScale=1 is an a11y bug.
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PronoBot" />
        <meta name="application-name" content="PronoBot" />
        <meta name="color-scheme" content="dark" />
        <meta name="msapplication-TileColor" content="#0A0A0A" />
        <meta name="msapplication-tap-highlight" content="no" />
        <meta property="og:title" content="PronoBot — Paris Sportifs IA" />
        <meta property="og:description" content="Pronostics football intelligents alimentés par IA." />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icon-512.png" />
        <meta name="twitter:card" content="summary_large_image" />
      </head>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        {/* Sonner Toaster — mounted so that `toast.success(...)` calls from
            page.tsx (import { toast } from 'sonner') actually render. */}
        <SonnerToaster
          position="top-center"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: '#141414',
              border: '1px solid rgba(0,255,0,0.3)',
              color: '#fff',
            },
          }}
        />
        {/* Service worker registration — moved out of inline
            `<script dangerouslySetInnerHTML>` into a client component
            (src/components/sw-register.tsx) for better CSP posture and
            testability. The component renders null on the server and only
            runs the registration effect in production. */}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
