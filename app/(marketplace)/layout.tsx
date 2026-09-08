import { MarketplaceProvider } from "@/components/providers/marketplace";

export default function MarketplaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <MarketplaceProvider>{children}</MarketplaceProvider>;
}
