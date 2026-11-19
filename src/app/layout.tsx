import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "vault-zk",
  applicationName: "Vault ZK",
  manifest: "/manifest.webmanifest",
  description:
    "Zero-knowledge personal data vault. Secrets are encrypted in the browser before they reach Supabase.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#174f3d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-svh flex flex-col bg-background pb-[env(safe-area-inset-bottom)] font-sans text-foreground">
        {children}
      </body>
    </html>
  );
}
