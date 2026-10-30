"use client";

import { useState } from "react";
import { btnSecondary, btnSm, inputCls } from "./ui";

// A read-only value with a copy button; falls back to selecting the text.
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        className={`${inputCls} font-mono text-xs`}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className={`${btnSecondary} ${btnSm} shrink-0`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* the field is selectable */
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
