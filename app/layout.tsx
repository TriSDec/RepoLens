import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoLens — See your code, connected",
  description: "Explore projects in JavaScript, TypeScript, Python, Java, Go, Rust, C/C++, C# and more as an interactive dependency map. Find cycles and trace change impact with private, local analysis.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
