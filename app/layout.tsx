import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "options-copilot",
  description:
    "Decision-support for covered calls and cash-secured puts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${fontSans.variable} ${fontMono.variable}`}>
      <body className="flex antialiased">
        <Nav />
        <main className="min-w-0 flex-1 p-8">{children}</main>
      </body>
    </html>
  );
}
