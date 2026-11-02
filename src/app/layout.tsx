import type { Metadata } from "next";
import "./globals.css";
import { ThemeScript } from "@/components/theme-switch";

export const metadata: Metadata = {
  title: { default: "Beqi Audit", template: "%s · Beqi Audit" },
  description: "Claude-run audits and fixes for Beqi's Webflow client sites",
};

export const dynamic = "force-dynamic";

// The root layout only sets up the document. The signed-in shell lives in
// (app)/layout.tsx; sign-in and shared reports use (public)/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- the App Router root layout covers every page */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <ThemeScript />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
