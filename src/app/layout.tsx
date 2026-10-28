import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Beqi Audit", template: "%s · Beqi Audit" },
  description: "Claude-run audits and fixes for Beqi's Webflow client sites",
};

export const dynamic = "force-dynamic";

// The root layout only sets up the document. The signed-in shell lives in
// (app)/layout.tsx; sign-in and shared reports use (public)/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
