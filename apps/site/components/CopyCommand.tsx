"use client";

import { useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be blocked; the command is still visible to select */
    }
  }

  return (
    <div className="cmd">
      <code>
        <span className="s">$</span> {command}
      </code>
      <button type="button" onClick={copy} aria-label="Copy install command">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
