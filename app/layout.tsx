import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "frende",
  description: "Real-time chat with automatic translation",
  icons: {
    icon: "/frende_logo.png",
    apple: "/frende_logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
