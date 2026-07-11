import type { Metadata } from "next";
import { Geist, Geist_Mono, Libre_Franklin } from "next/font/google";
import "./globals.css";
import { MarketplaceProvider } from "@/components/providers/marketplace";
import { AeLogoCorner } from "@/components/AeLogoIntro";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
const libreFranklin = Libre_Franklin({
  variable: "--font-libre-franklin",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "Content Transfer | SitecoreAI",
  description:
    "Transfer content between SitecoreAI environments using the Marketplace SDK.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${libreFranklin.variable} antialiased`}
      >
        <MarketplaceProvider>{children}</MarketplaceProvider>
        <AeLogoCorner />
      </body>
    </html>
  );
}
