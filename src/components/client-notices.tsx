import { Notice } from "./ui";

export type ClientSearch = { connected?: string; imported?: string; saved?: string; error?: string; notice?: string; unshared?: string };

// The one-off messages client tabs show after an action.
export function ClientNotices({ q }: { q: ClientSearch }) {
  return (
    <>
      {q.connected && (
        <Notice tone="good">
          Connected and {q.connected} site{q.connected === "1" ? "" : "s"} imported, each scheduled for a weekly audit. Use <strong>Audit now</strong> to run the first one.
        </Notice>
      )}
      {q.imported && <Notice tone="good">Site list refreshed from Webflow.</Notice>}
      {q.saved && <Notice tone="good">Saved.</Notice>}
      {q.notice && <Notice tone="good">{decodeURIComponent(q.notice)}</Notice>}
      {q.error && <Notice tone="critical">{decodeURIComponent(q.error)}</Notice>}
    </>
  );
}
