import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import LanguageRoot from "@/components/shared/LanguageRoot";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ForestChat",
  description: "AI-powered forest management — visualize and manage your forest plan through conversation.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
  var t=localStorage.getItem("forestchat-theme");
  if (t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches))
    document.documentElement.classList.add("dark");
} catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col"><LanguageRoot>{children}</LanguageRoot></body>
    </html>
  );
}
