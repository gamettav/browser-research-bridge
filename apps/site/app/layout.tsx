import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GroundTab",
  description:
    "A Chrome extension and agent plugin that give Claude Code and Codex local, read-only web research with one-time pairing.",
};

// Applies a saved theme before first paint so an explicit light/dark choice
// never flashes the opposite theme on load.
const noFlashTheme = `(function(){try{var t=localStorage.getItem('groundtab-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
