"use client";

import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "beqi-theme";

// Applies the stored choice to <html data-theme>; the CSS in globals.css does
// the rest. "system" removes the attribute so the media query decides.
function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

// Runs before React hydrates (inlined by ThemeScript) so the first paint is
// already in the chosen theme.
export const THEME_BOOT = `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />;
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

// The choice lives in localStorage; components read it through an external
// store so the server renders "system" and the client takes over without a
// setState-in-effect.
const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}
function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as ThemeChoice);
  const pick = (value: ThemeChoice) => {
    try {
      if (value === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      /* storage unavailable: the attribute still changes for this page */
    }
    apply(value);
    listeners.forEach((fn) => fn());
  };
  return (
    <div role="group" aria-label="Appearance" className={`inline-flex rounded-lg border border-line-2 bg-surface p-0.5 ${compact ? "" : "w-full"}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={choice === o.value}
          onClick={() => pick(o.value)}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${choice === o.value ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
