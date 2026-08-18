import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
});

// Named --font-jetbrains, not --font-mono: globals.css defines
// `--font-mono: var(--font-jetbrains), monospace`, and reusing the same
// name there made the declaration self-referential (so it resolved to
// nothing and every mono element silently fell back to the default).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "GarmentOS — Operations",
  description: "Operations dashboard for catalog, orders, production, and AI-assisted garment sales.",
  // Named explicitly rather than left to the manifest: iOS reads these two
  // and ignores the manifest's name and icons when adding to the Home Screen.
  appleWebApp: {
    capable: true,
    title: "GarmentOS",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#C4622D",
  // An installed console is a full-screen app; letting the page zoom on a
  // double tap makes the conversation list jump around under the thumb.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${cormorantGaramond.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          <ServiceWorkerRegistrar />
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
