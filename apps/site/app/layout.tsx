import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Browser Research Bridge",
  description:
    "A local, read-only bridge that lets Claude Code and Codex read fully rendered web pages through your own Chrome — no cloud, no cookie extraction, no bypasses.",
};

// Applies a saved theme before first paint so an explicit light/dark choice
// never flashes the opposite theme on load.
const noFlashTheme = `(function(){try{var t=localStorage.getItem('brb-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

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
