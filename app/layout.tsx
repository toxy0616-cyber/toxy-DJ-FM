import type { Metadata, Viewport } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Toxy FM",
  description: "A private 24/7 AI radio tuned by your taste.md.",
  applicationName: "Toxy FM",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Toxy FM"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050505"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
